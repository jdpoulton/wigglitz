// ============================================================================
//  Wigglitz 3D - Phase 3: "Up and down."
//
//  The engine grows from a flat 2D raycaster into a HEIGHTMAP VOXEL renderer:
//    * Every cell has an integer height level. Walls are tall columns you can
//      see over; building raises a cell (towers); digging lowers it (holes).
//    * Mouse-look: move the mouse to turn (yaw) and look up/down (pitch).
//    * Step-up climbing: walk up your own towers one block at a time; tall
//      walls block you; drop into pits.
//
//  Trade-off of a heightmap renderer (vs full voxels): cells are solid from the
//  floor up to their top, so there are no overhangs/caves -- but real stacking
//  and digging both work, in fast software rendering with zero installs.
//
//  Hybrid build unchanged: Wigglitz.WorldGen.Cell is HAND-WRITTEN IL (the hot
//  path); this C# shell is built by the in-box csc.exe. All state is in memory.
// ============================================================================

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Media;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Wigglitz;

namespace Wigglitz3D
{
    public static class Program
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        // Public so Play.ps1 can invoke it after compiling this file in memory.
        [STAThread]
        public static void Main()
        {
            try { SetProcessDPIAware(); } catch { }  // keep screen/cursor coords in one space
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new GameForm());
        }
    }

    struct Wig
    {
        public string Name;
        public Color A, B;
        public int Eyes;
        public Wig(string n, Color a, Color b, int e) { Name = n; A = a; B = b; Eyes = e; }
    }

    // A world cell: solid from the floor up to Top (in block levels); Mat = color.
    struct Cell
    {
        public int Top;
        public int Mat;
        public Cell(int t, int m) { Top = t; Mat = m; }
    }

    class Col
    {
        public double X, Y;
        public int Cidx;
        public bool Got;
        public double Tx, Ty;
        public Col(double x, double y, int c) { X = x; Y = y; Cidx = c; }
    }

    class Particle
    {
        public double X, Y, Vx, Vy, Life, MaxLife;
        public int Col;
    }

    class GameForm : Form
    {
        const int IW = 480;
        const int IH = 270;
        const int SX = 2;
        const int SY = 2;
        const int TW = 48;
        const int TH = 60;

        const int WALL_H = 3;       // natural walls are this tall
        const double FAR = 24.0;    // render distance (cells)
        const int MAXSTEPS = 64;
        const int MAXTOP = 12;
        const int MINTOP = -8;
        const double EYE = 0.6;     // eye height above the cell surface

        readonly int[] buf = new int[IW * IH];
        readonly double[] zbuf = new double[IW];
        readonly Bitmap bmp = new Bitmap(IW, IH, PixelFormat.Format32bppRgb);

        enum GState { Title, Select, Play }
        GState state = GState.Title;
        bool showCollection = false;

        readonly HashSet<Keys> keys = new HashSet<Keys>();

        // Camera
        double posX = SX + 0.5, posY = SY + 0.5;
        double dirX = -1, dirY = 0;
        double planeX = 0, planeY = 0.66;
        double pitch = 0;           // horizon offset in pixels (mouse look up/down)
        double eyeZsmooth = EYE;    // smoothed eye level (rides the surface)
        int seed = 1337;

        // Mouse-look capture
        bool cursorHidden = false;
        Point lastMouse = Point.Empty;
        double mouseSens = 0.7;             // adjustable in-game with - / +
        const double BASE_YAW = 0.0012;     // radians of turn per mouse pixel
        const double BASE_PITCH = 0.18;     // horizon pixels per mouse pixel
        const int MAX_DELTA = 160;          // clamp spurious jumps (focus changes)
        const double PITCH_LIMIT = 200;

        Wig[] roster;
        int sel = 0;
        int selBlock = 1;

        readonly Dictionary<long, Cell> edits = new Dictionary<long, Cell>();
        List<Col> collectibles;
        bool[] owned;
        int totalFound = 0;
        bool completeShown = false;

        int[][] sprTex;

        readonly List<Particle> particles = new List<Particle>();
        readonly Random rng = new Random(20240611);

        string toastText = "";
        double toastUntil = 0;

        readonly System.Diagnostics.Stopwatch sw = new System.Diagnostics.Stopwatch();
        double lastT = 0, now = 0;
        Timer timer;

        public GameForm()
        {
            Text = "Wigglitz 3D";
            ClientSize = new Size(960, 540);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.Black;
            DoubleBuffered = true;
            KeyPreview = true;
            BuildRoster();
            BuildSprites();
            BuildCollectibles();
            owned = new bool[roster.Length];
            sw.Start();
            lastT = sw.Elapsed.TotalSeconds;
            timer = new Timer();
            timer.Interval = 16;
            timer.Tick += new EventHandler(OnTick);
            timer.Start();
        }

        void BuildRoster()
        {
            roster = new Wig[]
            {
                new Wig("Winky",       Color.FromArgb(150, 80,200), Color.FromArgb( 40,180,170), 1),
                new Wig("Speckles",    Color.FromArgb( 90,190, 90), Color.FromArgb( 40,180,170), 2),
                new Wig("Scuba Steve", Color.FromArgb( 60,120,210), Color.FromArgb(230,200, 60), 2),
                new Wig("Miley",       Color.FromArgb( 40,180,170), Color.FromArgb(150, 80,200), 2),
                new Wig("Blooper",     Color.FromArgb(235,140, 50), Color.FromArgb(245,245,245), 2),
                new Wig("Starshine",   Color.FromArgb(170, 90,210), Color.FromArgb(240,210, 80), 2),
                new Wig("Jett",        Color.FromArgb(130,140,150), Color.FromArgb( 90,190, 90), 2),
                new Wig("Melly",       Color.FromArgb( 70,170, 80), Color.FromArgb(220, 70, 80), 2),
            };
        }

        void BuildSprites()
        {
            sprTex = new int[roster.Length][];
            for (int i = 0; i < roster.Length; i++)
            {
                using (Bitmap b = new Bitmap(TW, TH, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(b))
                    {
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.Clear(Color.Transparent);
                        DrawWig(g, TW / 2f, TH * 0.56f, 34f, roster[i], 0, false);
                    }
                    BitmapData bd = b.LockBits(new Rectangle(0, 0, TW, TH),
                        ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                    int[] px = new int[TW * TH];
                    Marshal.Copy(bd.Scan0, px, 0, px.Length);
                    b.UnlockBits(bd);
                    sprTex[i] = px;
                }
            }
        }

        static uint Hash(int x, int y, int s)
        {
            unchecked
            {
                uint h = (uint)(x * 73856093 ^ y * 19349663 ^ s * 83492791);
                h ^= h >> 13; h *= 0x5bd1e995; h ^= h >> 15;
                return h;
            }
        }

        void BuildCollectibles()
        {
            collectibles = new List<Col>();
            for (int gy = -50; gy <= 50; gy++)
                for (int gx = -50; gx <= 50; gx++)
                {
                    if (Math.Abs(gx - SX) < 3 && Math.Abs(gy - SY) < 3) continue;
                    if (CellBase(gx, gy).Top != 0) continue;       // only on open ground
                    uint h = Hash(gx, gy, seed ^ 0x55);
                    if (h % 100 == 0)
                        collectibles.Add(new Col(gx + 0.5, gy + 0.5, (int)((h >> 7) % (uint)roster.Length)));
                }
        }

        // ------------------------------------------------------------ world model
        static long Key(int x, int y) { return ((long)(uint)x << 32) | (uint)y; }

        Cell CellBase(int x, int y)
        {
            if (Math.Abs(x - SX) <= 2 && Math.Abs(y - SY) <= 2) return new Cell(0, 0);  // spawn clearing
            int t = WorldGen.Cell(x, y, seed);    // HAND-WRITTEN IL hot path
            if (t == 0) return new Cell(0, 0);    // open ground
            return new Cell(WALL_H, t);           // natural wall column
        }

        Cell CellAt(int x, int y)
        {
            Cell c;
            if (edits.TryGetValue(Key(x, y), out c)) return c;
            return CellBase(x, y);
        }

        void SetCell(int x, int y, int top, int mat) { edits[Key(x, y)] = new Cell(top, mat); }

        int TopAt(int x, int y) { return CellAt(x, y).Top; }

        static readonly int[] WR = { 0,  40, 150, 230,  90 };
        static readonly int[] WG = { 0, 180,  80, 200, 190 };
        static readonly int[] WB = { 0, 170, 200,  60,  90 };

        static int RGB(int r, int g, int b)
        {
            if (r < 0) r = 0; else if (r > 255) r = 255;
            if (g < 0) g = 0; else if (g > 255) g = 255;
            if (b < 0) b = 0; else if (b > 255) b = 255;
            return (255 << 24) | (r << 16) | (g << 8) | b;
        }

        int ColorOf(Cell c)
        {
            if (c.Top < 0) return RGB(120, 85, 55);             // dug: dirt
            if (c.Top == 0 && c.Mat == 0) return RGB(70, 130, 70); // grass ground
            int m = c.Mat; if (m < 1) m = 1; else if (m > 4) m = 4;
            return RGB(WR[m], WG[m], WB[m]);
        }

        static int Scale(int argb, double f)
        {
            int r = (int)(((argb >> 16) & 255) * f);
            int g = (int)(((argb >> 8) & 255) * f);
            int b = (int)((argb & 255) * f);
            if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
            return (255 << 24) | (r << 16) | (g << 8) | b;
        }

        static int LerpC(int a, int b, double t)
        {
            if (t < 0) t = 0; else if (t > 1) t = 1;
            int ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
            int br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
            return (255 << 24) | (((int)(ar + (br - ar) * t)) << 16)
                               | (((int)(ag + (bg - ag) * t)) << 8)
                               |  ((int)(ab + (bb - ab) * t));
        }

        int ShadeDist(int col, double d, int side)
        {
            double f = 1.9 / (d + 0.9);
            if (f > 1) f = 1; else if (f < 0.28) f = 0.28;
            if (side == 1) f *= 0.86;
            return Scale(col, f);
        }

        static int SkyAt(int y, double horizon)
        {
            double t = (horizon <= 1) ? 0 : y / horizon;
            return LerpC(RGB(25, 18, 50), RGB(95, 110, 150), t);
        }

        // ---------------------------------------------------------------- loop
        void OnTick(object s, EventArgs e)
        {
            now = sw.Elapsed.TotalSeconds;
            double dt = now - lastT;
            lastT = now;
            if (dt > 0.05) dt = 0.05;

            MouseLook();
            if (state == GState.Play && !showCollection) Update(dt);
            if (state == GState.Play) UpdateParticles(dt);
            Render();
        }

        void MouseLook()
        {
            bool want = (state == GState.Play && !showCollection && Focused && ActiveForm == this);
            if (!want)
            {
                if (cursorHidden) { Cursor.Show(); cursorHidden = false; }
                return;
            }
            if (!cursorHidden)
            {
                Cursor.Hide(); cursorHidden = true;
                RecenterCursor();
                return;                         // skip the first frame's delta
            }
            Point cur = Cursor.Position;
            int dx = cur.X - lastMouse.X;
            int dy = cur.Y - lastMouse.Y;
            if (dx > MAX_DELTA) dx = MAX_DELTA; else if (dx < -MAX_DELTA) dx = -MAX_DELTA;
            if (dy > MAX_DELTA) dy = MAX_DELTA; else if (dy < -MAX_DELTA) dy = -MAX_DELTA;
            if (dx != 0) Rotate(dx * BASE_YAW * mouseSens);
            if (dy != 0)
            {
                pitch -= dy * BASE_PITCH * mouseSens;
                if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;
                else if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
            }
            RecenterCursor();
        }

        // Pin the OS cursor to the window centre and remember where it actually
        // landed -- measuring deltas from the read-back point makes mouse-look
        // immune to DPI rounding drift (the old "spinning" feel).
        void RecenterCursor()
        {
            Point ctr = PointToScreen(new Point(ClientSize.Width / 2, ClientSize.Height / 2));
            Cursor.Position = ctr;
            lastMouse = Cursor.Position;
        }

        // --------------------------------------------------------------- player
        void Update(double dt)
        {
            double ms = 3.2 * dt;
            bool fwd     = keys.Contains(Keys.W) || keys.Contains(Keys.Up);
            bool back    = keys.Contains(Keys.S) || keys.Contains(Keys.Down);
            bool strafeL = keys.Contains(Keys.A) || keys.Contains(Keys.Left);
            bool strafeR = keys.Contains(Keys.D) || keys.Contains(Keys.Right);

            if (fwd)     TryMove(posX + dirX * ms, posY + dirY * ms);
            if (back)    TryMove(posX - dirX * ms, posY - dirY * ms);
            if (strafeR) TryMove(posX + dirY * ms, posY - dirX * ms);
            if (strafeL) TryMove(posX - dirY * ms, posY + dirX * ms);

            // eye rides the surface (climb towers, sink into pits), smoothed
            double target = TopAt((int)Math.Floor(posX), (int)Math.Floor(posY)) + EYE;
            double k = dt * 12; if (k > 1) k = 1;
            eyeZsmooth += (target - eyeZsmooth) * k;

            // pickups
            for (int i = 0; i < collectibles.Count; i++)
            {
                Col c = collectibles[i];
                if (c.Got) continue;
                double dx = c.X - posX, dy = c.Y - posY;
                if (dx * dx + dy * dy < 0.30)
                {
                    c.Got = true; totalFound++;
                    bool isNew = !owned[c.Cidx];
                    owned[c.Cidx] = true;
                    Toast(isNew ? ("NEW!  Collected " + roster[c.Cidx].Name + "!")
                                : ("Collected another " + roster[c.Cidx].Name));
                    try { SystemSounds.Asterisk.Play(); } catch { }
                    SpawnSparkle(roster[c.Cidx].A, roster[c.Cidx].B);
                    CheckComplete();
                }
            }
        }

        void TryMove(double nx, double ny)
        {
            int cx = (int)Math.Floor(posX), cy = (int)Math.Floor(posY);
            int curTop = TopAt(cx, cy);
            if (TopAt((int)Math.Floor(nx), cy) <= curTop + 1) posX = nx;
            cx = (int)Math.Floor(posX);
            if (TopAt(cx, (int)Math.Floor(ny)) <= curTop + 1) posY = ny;
        }

        void Rotate(double a)
        {
            double ca = Math.Cos(a), sa = Math.Sin(a);
            double ox = dirX;
            dirX = dirX * ca - dirY * sa;
            dirY = ox   * sa + dirY * ca;
            double opx = planeX;
            planeX = planeX * ca - planeY * sa;
            planeY = opx    * sa + planeY * ca;
        }

        void CheckComplete()
        {
            for (int i = 0; i < owned.Length; i++) if (!owned[i]) return;
            if (!completeShown)
            {
                completeShown = true;
                toastText = "COLLECTION COMPLETE!  You found every Wigglitz!";
                toastUntil = now + 5.0;
                try { SystemSounds.Exclamation.Play(); } catch { }
            }
        }

        void Toast(string t)
        {
            if (completeShown && now < toastUntil) return;
            toastText = t; toastUntil = now + 2.2;
        }

        // ------------------------------------------------------ build / dig
        // Picks the cell you're facing: first cell raised above you within reach,
        // else the cell ~1.2 units ahead. Always returns a cell.
        bool Target(out int tx, out int ty)
        {
            double rdx = dirX, rdy = dirY;
            int pcx = (int)Math.Floor(posX), pcy = (int)Math.Floor(posY);
            int surface = TopAt(pcx, pcy);
            int mapX = pcx, mapY = pcy;
            double ddx = (rdx == 0) ? 1e30 : Math.Abs(1.0 / rdx);
            double ddy = (rdy == 0) ? 1e30 : Math.Abs(1.0 / rdy);
            int stepX, stepY; double sdx, sdy;
            if (rdx < 0) { stepX = -1; sdx = (posX - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - posX) * ddx; }
            if (rdy < 0) { stepY = -1; sdy = (posY - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - posY) * ddy; }
            double d = 0, reach = 4.5;
            for (int i = 0; i < 24; i++)
            {
                if (sdx < sdy) { d = sdx; sdx += ddx; mapX += stepX; } else { d = sdy; sdy += ddy; mapY += stepY; }
                if (d > reach) break;
                if (TopAt(mapX, mapY) > surface) { tx = mapX; ty = mapY; return true; }
            }
            tx = (int)Math.Floor(posX + dirX * 1.2);
            ty = (int)Math.Floor(posY + dirY * 1.2);
            return false;
        }

        void DoMine()
        {
            int tx, ty; Target(out tx, out ty);
            Cell c = CellAt(tx, ty);
            int nt = c.Top - 1; if (nt < MINTOP) nt = MINTOP;
            SetCell(tx, ty, nt, c.Mat);
            SpawnBurst(ColorOf(c), 14);
        }

        void DoPlace()
        {
            int tx, ty; Target(out tx, out ty);
            if (tx == (int)Math.Floor(posX) && ty == (int)Math.Floor(posY)) return; // not your own cell
            Cell c = CellAt(tx, ty);
            int nt = c.Top + 1; if (nt > MAXTOP) nt = MAXTOP;
            SetCell(tx, ty, nt, selBlock);
            SpawnBurst(RGB(WR[selBlock], WG[selBlock], WB[selBlock]), 8);
        }

        // ------------------------------------------------------------ particles
        void SpawnBurst(int col, int n)
        {
            for (int i = 0; i < n; i++)
            {
                Particle p = new Particle();
                p.X = IW / 2.0; p.Y = IH / 2.0;
                double ang = rng.NextDouble() * Math.PI * 2, spd = 30 + rng.NextDouble() * 70;
                p.Vx = Math.Cos(ang) * spd; p.Vy = Math.Sin(ang) * spd - 40;
                p.MaxLife = p.Life = 0.45 + rng.NextDouble() * 0.3;
                p.Col = col; particles.Add(p);
            }
        }

        void SpawnSparkle(Color a, Color b)
        {
            for (int i = 0; i < 22; i++)
            {
                Particle p = new Particle();
                p.X = IW / 2.0; p.Y = IH * 0.62;
                double ang = rng.NextDouble() * Math.PI * 2, spd = 40 + rng.NextDouble() * 110;
                p.Vx = Math.Cos(ang) * spd; p.Vy = Math.Sin(ang) * spd - 60;
                p.MaxLife = p.Life = 0.6 + rng.NextDouble() * 0.5;
                Color c = (i % 3 == 0) ? Color.FromArgb(255, 240, 120) : ((i % 3 == 1) ? a : b);
                p.Col = RGB(c.R, c.G, c.B); particles.Add(p);
            }
        }

        void UpdateParticles(double dt)
        {
            for (int i = particles.Count - 1; i >= 0; i--)
            {
                Particle p = particles[i];
                p.X += p.Vx * dt; p.Y += p.Vy * dt; p.Vy += 220 * dt; p.Life -= dt;
                if (p.Life <= 0) particles.RemoveAt(i);
            }
        }

        // -------------------------------------------------- heightmap renderer
        void RenderWorld()
        {
            double horizon = IH / 2.0 + pitch;
            double eyeZ = eyeZsmooth;
            int pcx = (int)Math.Floor(posX), pcy = (int)Math.Floor(posY);

            for (int x = 0; x < IW; x++)
            {
                double cameraX = 2.0 * x / IW - 1.0;
                double rdx = dirX + planeX * cameraX;
                double rdy = dirY + planeY * cameraX;
                int mapX = pcx, mapY = pcy;
                double ddx = (rdx == 0) ? 1e30 : Math.Abs(1.0 / rdx);
                double ddy = (rdy == 0) ? 1e30 : Math.Abs(1.0 / rdy);
                int stepX, stepY; double sdx, sdy;
                if (rdx < 0) { stepX = -1; sdx = (posX - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - posX) * ddx; }
                if (rdy < 0) { stepY = -1; sdy = (posY - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - posY) * ddy; }

                double currentTopY = IH;     // fill boundary; below it is already drawn
                double zb = FAR; bool zbset = false;
                int side = 0; double d;

                for (int s = 0; s < MAXSTEPS; s++)
                {
                    if (sdx < sdy) { d = sdx; sdx += ddx; mapX += stepX; side = 0; }
                    else           { d = sdy; sdy += ddy; mapY += stepY; side = 1; }
                    if (d > FAR) break;
                    if (d < 0.05) continue;

                    Cell c = CellAt(mapX, mapY);
                    if (!zbset && c.Top >= eyeZ) { zb = d; zbset = true; }

                    double yT = horizon - (c.Top - eyeZ) * (IH / d);
                    int iyT = (int)yT;
                    if (iyT < currentTopY)
                    {
                        if (iyT < 0) iyT = 0;
                        int col = ShadeDist(ColorOf(c), d, side);
                        int bot = (int)currentTopY; if (bot > IH) bot = IH;
                        for (int y = iyT; y < bot; y++) buf[y * IW + x] = col;
                        currentTopY = iyT;
                        if (currentTopY <= 0) break;
                    }
                }

                zbuf[x] = zb;
                int ct = (int)currentTopY; if (ct > IH) ct = IH;
                for (int y = 0; y < ct; y++) buf[y * IW + x] = SkyAt(y, horizon);
            }
        }

        void DrawSprites()
        {
            double horizon = IH / 2.0 + pitch;
            double eyeZ = eyeZsmooth;
            double invDet = 1.0 / (planeX * dirY - dirX * planeY);
            for (int i = 0; i < collectibles.Count; i++)
            {
                Col c = collectibles[i];
                if (c.Got) { c.Ty = -1; continue; }
                double sx = c.X - posX, sy = c.Y - posY;
                c.Tx = invDet * (dirY * sx - dirX * sy);
                c.Ty = invDet * (-planeY * sx + planeX * sy);
            }
            collectibles.Sort(delegate (Col a, Col b) { return b.Ty.CompareTo(a.Ty); });

            for (int i = 0; i < collectibles.Count; i++)
            {
                Col c = collectibles[i];
                if (c.Got || c.Ty < 0.15) continue;
                int[] tex = sprTex[c.Cidx];

                int cellTop = TopAt((int)Math.Floor(c.X), (int)Math.Floor(c.Y));
                int screenX = (int)((IW / 2) * (1 + c.Tx / c.Ty));
                int fullH = (int)(IH / c.Ty);
                int sprH = (int)(fullH * 0.80);
                int sprW = (int)(sprH * (double)TW / TH);
                int hover = (int)(Math.Sin(now * 2.0 + i) * fullH * 0.04);
                int feetY = (int)(horizon - (cellTop - eyeZ) * (IH / c.Ty)) + hover;
                int endY = feetY;
                int startY = endY - sprH;
                int startX = screenX - sprW / 2;
                if (startX + sprW < 0 || startX >= IW || sprW <= 0 || sprH <= 0) continue;

                for (int x = startX; x < startX + sprW; x++)
                {
                    if (x < 0 || x >= IW) continue;
                    if (!(c.Ty < zbuf[x])) continue;
                    int texX = (int)((x - startX) * (double)TW / sprW);
                    if (texX < 0 || texX >= TW) continue;
                    for (int y = startY; y < endY; y++)
                    {
                        if (y < 0 || y >= IH) continue;
                        int texY = (int)((y - startY) * (double)TH / sprH);
                        if (texY < 0 || texY >= TH) continue;
                        int px = tex[texY * TW + texX];
                        if (((px >> 24) & 0xff) < 128) continue;
                        buf[y * IW + x] = Scale(px, ShadeFactor(c.Ty));
                    }
                }
            }
        }

        static double ShadeFactor(double d)
        {
            double f = 1.9 / (d + 0.9);
            if (f > 1) f = 1; else if (f < 0.4) f = 0.4;
            return f;
        }

        void CopyBuf()
        {
            BitmapData bd = bmp.LockBits(new Rectangle(0, 0, IW, IH),
                ImageLockMode.WriteOnly, PixelFormat.Format32bppRgb);
            Marshal.Copy(buf, 0, bd.Scan0, buf.Length);
            bmp.UnlockBits(bd);
        }

        // --------------------------------------------------------------- frame
        void Render()
        {
            if (state == GState.Play)
            {
                RenderWorld();
                DrawSprites();
                CopyBuf();
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
                    DrawParticles(g);
                    DrawHud(g);
                    if (showCollection) DrawCollection(g);
                }
            }
            else
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
                    DrawMenuBg(g);
                    if (state == GState.Title) DrawTitle(g);
                    else DrawSelect(g);
                }
            }
            Invalidate();
        }

        void DrawParticles(Graphics g)
        {
            for (int i = 0; i < particles.Count; i++)
            {
                Particle p = particles[i];
                int a = (int)(255 * (p.Life / p.MaxLife)); if (a < 0) a = 0; else if (a > 255) a = 255;
                Color c = Color.FromArgb(a, (p.Col >> 16) & 255, (p.Col >> 8) & 255, p.Col & 255);
                using (SolidBrush b = new SolidBrush(c)) g.FillRectangle(b, (float)p.X, (float)p.Y, 2.4f, 2.4f);
            }
        }

        // ----------------------------------------------------------------- HUD
        void DrawHud(Graphics g)
        {
            int tx, ty; bool onBlock = Target(out tx, out ty);
            Color cross = onBlock ? Color.FromArgb(255, 255, 230, 90) : Color.FromArgb(170, 255, 255, 255);
            using (Pen p = new Pen(cross, onBlock ? 1.6f : 1f))
            {
                g.DrawLine(p, IW / 2 - 5, IH / 2, IW / 2 + 5, IH / 2);
                g.DrawLine(p, IW / 2, IH / 2 - 5, IW / 2, IH / 2 + 5);
            }

            DrawHotbar(g);
            DrawMiniMap(g);

            using (Font f = new Font("Segoe UI", 9f, FontStyle.Bold))
            {
                string s = "Wigglitz: " + CountOwned() + " / " + roster.Length + "   (picked up " + totalFound + ")";
                using (SolidBrush bg = new SolidBrush(Color.FromArgb(150, 0, 0, 0)))
                {
                    SizeF sz = g.MeasureString(s, f);
                    g.FillRectangle(bg, IW / 2 - sz.Width / 2 - 5, 3, sz.Width + 10, sz.Height + 2);
                }
                CenterStr(g, s, f, Color.White, IW / 2, 12);
            }

            using (Font f = new Font("Segoe UI", 7f))
                g.DrawString("Mouse look ( - / + sensitivity)  WASD move  LMB dig  RMB build  1-4 block  C collection  Esc menu",
                             f, Brushes.White, 6, IH - 14);

            DrawToast(g);
        }

        int CountOwned() { int n = 0; for (int i = 0; i < owned.Length; i++) if (owned[i]) n++; return n; }

        void DrawHotbar(Graphics g)
        {
            int n = 4, cell = 26, gap = 4;
            int total = n * cell + (n - 1) * gap;
            int ox = IW / 2 - total / 2, oy = IH - 42;
            for (int i = 1; i <= n; i++)
            {
                int x = ox + (i - 1) * (cell + gap);
                using (SolidBrush b = new SolidBrush(Color.FromArgb(WR[i], WG[i], WB[i])))
                    g.FillRectangle(b, x, oy, cell, cell);
                using (Pen p = new Pen(i == selBlock ? Color.FromArgb(255, 240, 90) : Color.FromArgb(160, 0, 0, 0),
                                       i == selBlock ? 2.5f : 1f))
                    g.DrawRectangle(p, x, oy, cell, cell);
                using (Font f = new Font("Segoe UI", 7f, FontStyle.Bold))
                    g.DrawString(i.ToString(), f, Brushes.White, x + 2, oy + 1);
            }
        }

        void DrawMiniMap(Graphics g)
        {
            int R = 7, cell = 5;
            int size = (2 * R + 1) * cell;
            int ox = IW - size - 6, oy = 22;
            using (SolidBrush bg = new SolidBrush(Color.FromArgb(150, 0, 0, 0)))
                g.FillRectangle(bg, ox - 2, oy - 2, size + 4, size + 4);

            int pcx = (int)Math.Floor(posX), pcy = (int)Math.Floor(posY);
            for (int yy = -R; yy <= R; yy++)
                for (int xx = -R; xx <= R; xx++)
                {
                    Cell c = CellAt(pcx + xx, pcy + yy);
                    Color col;
                    if (c.Top > 0) { double b = 0.5 + 0.5 * Math.Min(1.0, c.Top / 4.0); col = Color.FromArgb((int)(WR[Clamp14(c.Mat)] * b), (int)(WG[Clamp14(c.Mat)] * b), (int)(WB[Clamp14(c.Mat)] * b)); }
                    else if (c.Top < 0) col = Color.FromArgb(90, 65, 45);
                    else col = Color.FromArgb(55, 75, 55);
                    using (SolidBrush b2 = new SolidBrush(col))
                        g.FillRectangle(b2, ox + (xx + R) * cell, oy + (yy + R) * cell, cell - 1, cell - 1);
                }
            for (int i = 0; i < collectibles.Count; i++)
            {
                Col c = collectibles[i];
                if (c.Got) continue;
                int rx = (int)Math.Floor(c.X) - pcx, ry = (int)Math.Floor(c.Y) - pcy;
                if (rx < -R || rx > R || ry < -R || ry > R) continue;
                using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 245, 120)))
                    g.FillEllipse(b, ox + (rx + R) * cell, oy + (ry + R) * cell, cell - 1, cell - 1);
            }
            using (SolidBrush b = new SolidBrush(Color.White))
                g.FillEllipse(b, ox + R * cell, oy + R * cell, cell - 1, cell - 1);
        }

        static int Clamp14(int m) { if (m < 1) return 1; if (m > 4) return 4; return m; }

        void DrawToast(Graphics g)
        {
            if (now >= toastUntil || toastText.Length == 0) return;
            int a = (int)(255 * Math.Min(1.0, (toastUntil - now) / 0.5));
            using (Font f = new Font("Segoe UI", 12f, FontStyle.Bold))
            {
                SizeF sz = g.MeasureString(toastText, f);
                using (SolidBrush bg = new SolidBrush(Color.FromArgb(a * 150 / 255, 0, 0, 0)))
                    g.FillRectangle(bg, IW / 2 - sz.Width / 2 - 8, 66, sz.Width + 16, sz.Height + 6);
                using (SolidBrush b = new SolidBrush(Color.FromArgb(a, 255, 235, 120)))
                    g.DrawString(toastText, f, b, IW / 2 - sz.Width / 2, 69);
            }
        }

        void DrawCollection(Graphics g)
        {
            using (SolidBrush dim = new SolidBrush(Color.FromArgb(210, 12, 10, 26)))
                g.FillRectangle(dim, 0, 0, IW, IH);
            using (Font f1 = new Font("Segoe UI", 18f, FontStyle.Bold))
            using (Font f2 = new Font("Segoe UI", 9f, FontStyle.Bold))
            using (Font f3 = new Font("Segoe UI", 8f))
            {
                CenterStr(g, "YOUR WIGGLITZ COLLECTION", f1, Color.FromArgb(255, 230, 90), IW / 2, 26);
                CenterStr(g, "Found " + CountOwned() + " of " + roster.Length, f2, Color.White, IW / 2, 50);
                int cols = 4, cw = 100, chh = 78;
                int ox = IW / 2 - (cols * cw) / 2, oy = 66;
                for (int i = 0; i < roster.Length; i++)
                {
                    int cxi = i % cols, cyi = i / cols;
                    float cx = ox + cxi * cw + cw / 2f;
                    float cy = oy + cyi * chh + 30;
                    if (owned[i])
                    {
                        DrawWig(g, cx, cy, 30f, roster[i], now + i, false);
                        CenterStr(g, roster[i].Name, f3, Color.White, (int)cx, (int)cy + 32);
                    }
                    else
                    {
                        using (SolidBrush b = new SolidBrush(Color.FromArgb(60, 60, 70)))
                            g.FillEllipse(b, cx - 15, cy - 18, 30, 36);
                        CenterStr(g, "? ? ?", f3, Color.FromArgb(120, 120, 130), (int)cx, (int)cy + 32);
                    }
                }
                CenterStr(g, completeShown ? "COMPLETE!  Press C to return"
                                           : "Explore to find them all.   Press C to return",
                          f3, Color.FromArgb(205, 220, 230), IW / 2, IH - 16);
            }
        }

        // --------------------------------------------------------------- menus
        void DrawMenuBg(Graphics g)
        {
            using (LinearGradientBrush br = new LinearGradientBrush(new Rectangle(0, 0, IW, IH),
                       Color.FromArgb(35, 25, 70), Color.FromArgb(20, 60, 75), 90f))
                g.FillRectangle(br, 0, 0, IW, IH);
            for (int i = 0; i < 26; i++)
            {
                double ph = now * 0.4 + i * 1.7;
                int dx = (int)((Math.Sin(ph) * 0.5 + 0.5) * IW);
                int dy = (int)(((i * 53) % IH) + Math.Sin(now + i) * 6);
                using (SolidBrush b = new SolidBrush(Color.FromArgb(35, 255, 255, 255)))
                    g.FillEllipse(b, dx, dy, 3, 3);
            }
        }

        void DrawTitle(Graphics g)
        {
            DrawWig(g, IW / 2f, 150f, 46f, roster[0], now, false);
            using (Font f1 = new Font("Segoe UI", 34f, FontStyle.Bold))
            using (Font f2 = new Font("Segoe UI", 10f, FontStyle.Bold))
            using (Font f3 = new Font("Segoe UI", 9f))
            {
                CenterStr(g, "WIGGLITZ", f1, Color.FromArgb(255, 230, 90), IW / 2, 70);
                CenterStr(g, "3D  SANDBOX", f2, Color.FromArgb(120, 220, 210), IW / 2, 108);
                if (((int)(now * 2)) % 2 == 0)
                    CenterStr(g, "Press ENTER to choose your Wigglitz", f3, Color.White, IW / 2, 200);
                CenterStr(g, "look - move - dig - build towers - collect them all", f3,
                          Color.FromArgb(180, 200, 210), IW / 2, 226);
            }
        }

        void DrawSelect(Graphics g)
        {
            using (Font f1 = new Font("Segoe UI", 16f, FontStyle.Bold))
            using (Font f2 = new Font("Segoe UI", 11f, FontStyle.Bold))
            using (Font f3 = new Font("Segoe UI", 8f))
            {
                CenterStr(g, "CHOOSE YOUR WIGGLITZ", f1, Color.FromArgb(255, 230, 90), IW / 2, 24);
                int n = roster.Length, spacing = IW / (n + 1), rowY = 130;
                for (int i = 0; i < n; i++)
                {
                    int cx = spacing * (i + 1);
                    float scale = (i == sel) ? 40f : 28f;
                    DrawWig(g, cx, rowY, scale, roster[i], now + i, false);
                    if (i == sel)
                        using (Pen p = new Pen(Color.FromArgb(255, 230, 90), 2f))
                            g.DrawRectangle(p, cx - 30, rowY - 46, 60, 80);
                }
                CenterStr(g, roster[sel].Name, f2, Color.White, IW / 2, 190);
                CenterStr(g, "LEFT / RIGHT to choose      ENTER to enter the world",
                          f3, Color.FromArgb(205, 220, 230), IW / 2, 232);
            }
        }

        void CenterStr(Graphics g, string s, Font f, Color c, int cx, int cy)
        {
            SizeF sz = g.MeasureString(s, f);
            using (SolidBrush b = new SolidBrush(c)) g.DrawString(s, f, b, cx - sz.Width / 2f, cy - sz.Height / 2f);
        }

        // ---------------------------------------------------- wigglitz sprite
        void DrawWig(Graphics g, float cx, float cy, float s, Wig w, double t, bool bobBig)
        {
            float bob = (float)Math.Sin(t * 4.0) * s * (bobBig ? 0.05f : 0.08f);
            float wg = (float)Math.Sin(t * 3.0) * s * 0.04f;
            cy += bob;
            float bw = s, bh = s * 1.12f;

            using (SolidBrush sh = new SolidBrush(Color.FromArgb(60, 0, 0, 0)))
                g.FillEllipse(sh, cx - bw * 0.45f + wg, cy + bh * 0.5f, bw * 0.9f, bh * 0.18f);
            using (SolidBrush fb = new SolidBrush(Darken(w.A, 0.7f)))
            {
                g.FillEllipse(fb, cx - bw * 0.32f + wg, cy + bh * 0.34f, bw * 0.26f, bh * 0.18f);
                g.FillEllipse(fb, cx + bw * 0.06f + wg, cy + bh * 0.34f, bw * 0.26f, bh * 0.18f);
            }
            using (SolidBrush bb = new SolidBrush(w.A))
                g.FillEllipse(bb, cx - bw / 2 + wg, cy - bh / 2, bw, bh);
            using (SolidBrush bl = new SolidBrush(w.B))
                g.FillEllipse(bl, cx - bw * 0.28f + wg, cy - bh * 0.10f, bw * 0.56f, bh * 0.5f);

            float ex = cx + wg, ey = cy - bh * 0.18f;
            float look = (float)Math.Sin(t * 1.5) * s * 0.04f;
            if (w.Eyes == 1)
            {
                float er = s * 0.26f;
                using (SolidBrush we = new SolidBrush(Color.White)) g.FillEllipse(we, ex - er, ey - er, er * 2, er * 2);
                float pr = er * 0.5f;
                using (SolidBrush pe = new SolidBrush(Color.FromArgb(30, 30, 40))) g.FillEllipse(pe, ex - pr + look, ey - pr, pr * 2, pr * 2);
            }
            else
            {
                float er = s * 0.15f, off = s * 0.18f;
                for (int sgn = -1; sgn <= 1; sgn += 2)
                {
                    float exx = ex + sgn * off;
                    using (SolidBrush we = new SolidBrush(Color.White)) g.FillEllipse(we, exx - er, ey - er, er * 2, er * 2);
                    float pr = er * 0.5f;
                    using (SolidBrush pe = new SolidBrush(Color.FromArgb(30, 30, 40))) g.FillEllipse(pe, exx - pr + look, ey - pr, pr * 2, pr * 2);
                }
            }
            using (Pen p = new Pen(Darken(w.A, 0.6f), 1.5f))
                g.DrawLine(p, cx + wg, cy - bh * 0.5f, cx + wg, cy - bh * 0.66f);
            using (SolidBrush ab = new SolidBrush(w.B))
                g.FillEllipse(ab, cx + wg - s * 0.05f, cy - bh * 0.72f, s * 0.1f, s * 0.1f);
        }

        static Color Darken(Color c, float f) { return Color.FromArgb(c.A, (int)(c.R * f), (int)(c.G * f), (int)(c.B * f)); }

        // --------------------------------------------------------- key handling
        protected override bool IsInputKey(Keys k)
        {
            if (k == Keys.Left || k == Keys.Right || k == Keys.Up || k == Keys.Down) return true;
            return base.IsInputKey(k);
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            keys.Add(e.KeyCode);
            if (state == GState.Title)
            {
                if (e.KeyCode == Keys.Enter) state = GState.Select;
                else if (e.KeyCode == Keys.Escape) Close();
            }
            else if (state == GState.Select)
            {
                if (e.KeyCode == Keys.Left) sel = (sel - 1 + roster.Length) % roster.Length;
                else if (e.KeyCode == Keys.Right) sel = (sel + 1) % roster.Length;
                else if (e.KeyCode == Keys.Enter) StartWorld();
                else if (e.KeyCode == Keys.Escape) state = GState.Title;
            }
            else
            {
                if (e.KeyCode == Keys.C || e.KeyCode == Keys.Tab) showCollection = !showCollection;
                else if (e.KeyCode == Keys.Escape)
                {
                    if (showCollection) showCollection = false;
                    else state = GState.Select;
                }
                else if (e.KeyCode == Keys.D1) selBlock = 1;
                else if (e.KeyCode == Keys.D2) selBlock = 2;
                else if (e.KeyCode == Keys.D3) selBlock = 3;
                else if (e.KeyCode == Keys.D4) selBlock = 4;
                else if (e.KeyCode == Keys.OemMinus || e.KeyCode == Keys.Subtract)
                { mouseSens = Math.Max(0.2, mouseSens / 1.25); Toast("Mouse sensitivity: " + (int)Math.Round(mouseSens * 100) + "%"); }
                else if (e.KeyCode == Keys.Oemplus || e.KeyCode == Keys.Add)
                { mouseSens = Math.Min(4.0, mouseSens * 1.25); Toast("Mouse sensitivity: " + (int)Math.Round(mouseSens * 100) + "%"); }
            }
            e.Handled = true;
            base.OnKeyDown(e);
        }

        void StartWorld()
        {
            state = GState.Play;
            showCollection = false;
            posX = SX + 0.5; posY = SY + 0.5;
            dirX = -1; dirY = 0; planeX = 0; planeY = 0.66;
            pitch = 0;
            eyeZsmooth = TopAt(SX, SY) + EYE;
        }

        protected override void OnKeyUp(KeyEventArgs e) { keys.Remove(e.KeyCode); base.OnKeyUp(e); }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            Focus();
            if (state == GState.Play && !showCollection)
            {
                if (e.Button == MouseButtons.Left) DoMine();
                else if (e.Button == MouseButtons.Right) DoPlace();
            }
            base.OnMouseDown(e);
        }

        protected override void OnPaintBackground(PaintEventArgs e) { }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
            e.Graphics.PixelOffsetMode = PixelOffsetMode.Half;
            e.Graphics.DrawImage(bmp, 0, 0, ClientSize.Width, ClientSize.Height);
        }
    }
}
