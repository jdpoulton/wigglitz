// ============================================================================
//  WorldGen.il  -  hand-written CIL (IL assembly) for the Wigglitz 3D world.
//
//  This is the "binary / base layer" piece of the project: every instruction
//  below is authored by hand and assembled by the pre-installed ilasm.exe into
//  a real .NET assembly (WorldGen.dll), which the C# game references.
//
//  Cell(x, y, seed) is the procedural world generator. The raycaster calls it
//  thousands of times per frame while stepping rays through the grid, so this
//  is the genuine hot path -- exactly where hand-tuned low-level code belongs.
//
//  Algorithm: an integer hash of (x, y, seed) -> a tile id.
//    0      = open / walkable space
//    1..4   = a solid wall, coloured by type (Wigglitz palette)
//  About 22% of cells are walls, giving an explorable pillared open map.
//
//  Build:  ilasm /dll /output:WorldGen.dll WorldGen.il
// ============================================================================

.assembly extern mscorlib { .ver 4:0:0:0 }
.assembly WorldGen        { .ver 1:0:0:0 }
.module WorldGen.dll

.class public abstract auto ansi sealed beforefieldinit Wigglitz.WorldGen
       extends [mscorlib]System.Object
{
  // int32 Cell(int32 x, int32 y, int32 seed)
  .method public hidebysig static int32 Cell(int32 x, int32 y, int32 seed) cil managed
  {
    .maxstack 8
    .locals init (int32 h, int32 r)

    // h = x*374761393 + y*668265263 + seed*0x9E3779B1   (wrapping 32-bit)
    ldarg.0
    ldc.i4     374761393
    mul
    ldarg.1
    ldc.i4     668265263
    mul
    add
    ldarg.2
    ldc.i4     -1640531535          // 0x9E3779B1 as signed int32
    mul
    add
    stloc.0

    // h = (h ^ (h >>> 13)) * 1274126177
    ldloc.0
    ldloc.0
    ldc.i4.s   13
    shr.un
    xor
    ldc.i4     1274126177
    mul
    stloc.0

    // h = h ^ (h >>> 16)
    ldloc.0
    ldloc.0
    ldc.i4.s   16
    shr.un
    xor
    stloc.0

    // r = h % 100   (unsigned)
    ldloc.0
    ldc.i4.s   100
    rem.un
    stloc.1

    // if (r < 78) return 0;   // ~78% open space
    ldloc.1
    ldc.i4.s   78
    blt.un     OPEN

    // else return ((h >>> 7) % 4) + 1;   // wall type 1..4
    ldloc.0
    ldc.i4.s   7
    shr.un
    ldc.i4.4
    rem.un
    ldc.i4.1
    add
    ret

  OPEN:
    ldc.i4.0
    ret
  }
}
