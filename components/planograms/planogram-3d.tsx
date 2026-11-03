"use client";

import { Box, Maximize2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as Three from "three";
import type { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { slotKey, widthInSlots } from "@/modules/planograms/geometry";
import type { RenderInput } from "@/modules/planograms/render";
import {
  DEFAULT_PACK,
  depthRows,
  edgeColor,
  facingPlacements,
  PACK_GAP,
  type PackPlacement,
} from "@/modules/planograms/scene3d";

// The planogram on its equipment in 3D, like the real display cabinets in a shop: a light box
// header on top, shelves with packs three deep, a price-tag holder on every shelf edge, a base
// with drawers. Sizes in centimetres.
const PACK = DEFAULT_PACK; // the library has no pack sizes yet
const SLOT = PACK.w + PACK_GAP; // one facing
const SHELF_H = 13; // shelf to shelf
const BOARD_T = 1.6; // shelf board thickness
const HOLDER_H = 2.6; // the price-tag holder on the board's front edge
const TAG_H = 2.1;
const SIDE = 2; // cabinet walls
const DEPTH = 32;
const BASE_H = 42;
const HEADER_H = 22;
const MARGIN = 1.6;
const EYE_H = 150; // a shopper's eyes
const FOV = 38;
const BACKGROUND = "#e3e5e8";

type View = "front" | "left" | "right";
type Finish = "dark" | "light";

const FINISH: Record<Finish, { body: string; inner: string; edge: string }> = {
  light: { body: "#e6e6e6", inner: "#f1f1f1", edge: "#c9c9c9" },
  dark: { body: "#2a2a2a", inner: "#333538", edge: "#1c1c1c" },
};

type ThreeModule = typeof Three;
type SkuCell = Extract<RenderInput["cells"][string], { kind: "SKU" }>;
type Placed = PackPlacement & { y: number };

// A canvas with text, used as a texture (pack fronts without a picture, price tags, header).
function canvasTexture(
  THREE: ThreeModule,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  const size = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 16);
  const step = size * 1.15;
  lines.slice(0, 4).forEach((l, i) => ctx.fillText(l, x, y + i * step));
}

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function imageTexture(THREE: ThreeModule, src: string, onLoad?: (image: HTMLImageElement) => void) {
  const texture = new THREE.TextureLoader().load(src, (loaded) => onLoad?.(loaded.image));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// The side colour worked out in the browser, for a picture the server hasn't measured.
function edgeColorOfImage(image: HTMLImageElement): string | null {
  try {
    const height = 32;
    const width = Math.max(1, Math.round((image.width / Math.max(1, image.height)) * height));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0, width, height);
    return edgeColor(ctx.getImageData(0, 0, width, height).data, width, height, 4);
  } catch {
    return null;
  }
}

// A rounded pack whose faces are in two material groups: 0 = sides, top and bottom; 1 = the front.
// Two draw calls per SKU instead of six.
function packGeometry(THREE: ThreeModule, RoundedBox: typeof RoundedBoxGeometry) {
  const source = new RoundedBox(PACK.w, PACK.h, PACK.d, 1, 0.1);
  const front = source.groups[4]!; // +z
  const order = [...source.groups.filter((g) => g !== front), front];
  const geometry = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"] as const) {
    const attribute = source.getAttribute(name);
    const size = attribute.itemSize;
    const array = new Float32Array(attribute.count * size);
    let at = 0;
    for (const group of order) {
      array.set(
        (attribute.array as Float32Array).subarray(
          group.start * size,
          (group.start + group.count) * size,
        ),
        at,
      );
      at += group.count * size;
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  const sides = source.groups.reduce((sum, g) => sum + g.count, 0) - front.count;
  geometry.addGroup(0, sides, 0);
  geometry.addGroup(sides, front.count, 1);
  source.dispose();
  return geometry;
}
export function Planogram3D({ input }: { input: RenderInput }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ setView: (v: View) => void; reset: () => void } | null>(null);
  const [finish, setFinish] = useState<Finish>("light");
  const [ready, setReady] = useState(false);
  // The browser can't draw 3D (no WebGL) or the 3D code didn't load.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let frame = 0;
    let cleanup = () => {};

    void (async () => {
      const started = performance.now();
      const THREE = await import("three");
      if (disposed) return;
      if (!webglAvailable()) throw new Error("webgl");
      const [{ OrbitControls }, { RoomEnvironment }, { RoundedBoxGeometry }] = await Promise.all([
        import("three/examples/jsm/controls/OrbitControls.js"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
        import("three/examples/jsm/geometries/RoundedBoxGeometry.js"),
      ]);
      if (disposed) return;

      const { geometry, cells, header } = input;
      const vertical = geometry.header === "vertical" && header;
      const horizontal = geometry.header === "horizontal" && header;
      const slots = widthInSlots(geometry);
      const innerW = slots * SLOT + MARGIN * 2;
      const sideHeaderW = vertical ? 14 : 0;
      const shelvesH = geometry.shelves.length * SHELF_H + 4;
      const bodyW = innerW + SIDE * 2 + sideHeaderW;
      // A horizontal header as tall as its picture needs to fill the width (within limits).
      const headerH =
        horizontal && header.image && header.aspect
          ? Math.min(innerW * 0.45, Math.max(HEADER_H, innerW / header.aspect + 4))
          : HEADER_H;
      const totalH = BASE_H + shelvesH + (horizontal ? headerH + 2 : 3);
      const left = -bodyW / 2 + SIDE + sideHeaderW; // inner left edge

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(BACKGROUND);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = true;
      // PCFSoftShadowMap was folded into PCFShadowMap in three r18x; the radius softens it.
      renderer.shadowMap.type = THREE.PCFShadowMap;
      element.appendChild(renderer.domElement);

      // Soft light from all around: a neutral room, built in code (no HDR files).
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const environment = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      scene.environment = environment;
      scene.environmentIntensity = 0.45;

      const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 3000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.minDistance = 40;
      controls.maxDistance = 800;
      controls.maxPolarAngle = Math.PI * 0.55;
      const center = new THREE.Vector3(0, totalH * 0.55, 0);
      controls.target.copy(center);

      // One key light from above, in front and to the left, casting shadows only around the
      // display; a weak sky light for the rest.
      scene.add(new THREE.HemisphereLight("#ffffff", "#c8ccd2", 0.3));
      const key = new THREE.DirectionalLight("#ffffff", 1.7);
      key.position.set(-90, totalH + 140, 170);
      key.target.position.set(0, totalH / 2, 0);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.radius = 3;
      key.shadow.bias = -0.0004;
      key.shadow.normalBias = 0.03;
      const reach = Math.max(bodyW, totalH) * 0.62 + 20;
      Object.assign(key.shadow.camera, {
        left: -reach,
        right: reach,
        top: reach,
        bottom: -reach,
        near: 50,
        far: totalH + 500,
      });
      scene.add(key, key.target);

      const shade = <T extends Three.Object3D>(mesh: T, cast = true): T => {
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        return mesh;
      };

      // The shop around: a tiled floor with a soft reflection, a plain wall with a steel skirting,
      // columns, and quiet neutral shelving on both sides so the eye stays on the display.
      const floorTexture = canvasTexture(THREE, 512, 512, (ctx) => {
        ctx.fillStyle = "#b9bdc2";
        ctx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < 4; j++) {
            const tone = 182 + ((i * 7 + j * 13) % 5) * 3;
            ctx.fillStyle = `rgb(${tone},${tone + 3},${tone + 6})`;
            ctx.fillRect(i * 128 + 2, j * 128 + 2, 124, 124);
          }
      });
      floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
      floorTexture.repeat.set(20, 20);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(1200, 1200),
        new THREE.MeshStandardMaterial({
          map: floorTexture,
          roughness: 0.35,
          metalness: 0,
          envMapIntensity: 0.5,
        }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      const wallZ = -DEPTH / 2 - 6;
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(1200, 600),
        new THREE.MeshStandardMaterial({ color: "#d6d9dd", roughness: 0.9 }),
      );
      wall.position.set(0, 300, wallZ);
      wall.receiveShadow = true;
      scene.add(wall);
      const skirting = new THREE.Mesh(
        new THREE.BoxGeometry(1200, 12, 1.2),
        new THREE.MeshStandardMaterial({ color: "#c4c8cd", metalness: 0.7, roughness: 0.35 }),
      );
      skirting.position.set(0, 6, wallZ + 0.6);
      scene.add(skirting);
      const columnMaterial = new THREE.MeshStandardMaterial({ color: "#7d838b", roughness: 0.6 });
      const rackMaterial = new THREE.MeshStandardMaterial({ color: "#e4e5e7", roughness: 0.8 });
      // Background goods: grey-beige packs, one instanced mesh for all of them.
      const goodsTones = ["#cdc6bb", "#c2bdb4", "#d6d0c6", "#bcb7af", "#d0cbc3", "#c8c2b7"];
      const rackW = 100;
      const perRow = 15;
      const levels = 6;
      const goods = new THREE.InstancedMesh(
        new THREE.BoxGeometry(PACK.w, PACK.h, PACK.d * 3),
        new THREE.MeshStandardMaterial({ roughness: 0.8 }),
        2 * levels * perRow,
      );
      const place = new THREE.Object3D();
      const tone = new THREE.Color();
      let goodsCount = 0;
      for (const side of [-1, 1]) {
        const column = shade(
          new THREE.Mesh(new THREE.BoxGeometry(14, 600, 8), columnMaterial),
          true,
        );
        column.position.set(side * (bodyW / 2 + 95), 300, wallZ + 4);
        scene.add(column);
        const rackX = side * (bodyW / 2 + 95 + 7 + rackW / 2 + 6);
        const back = new THREE.Mesh(new THREE.BoxGeometry(rackW, 180, 2), rackMaterial);
        back.position.set(rackX, 90, wallZ + 2);
        scene.add(back);
        for (let level = 0; level < levels; level++) {
          const y = 18 + level * 27;
          const board = new THREE.Mesh(new THREE.BoxGeometry(rackW, 1.2, 26), rackMaterial);
          board.position.set(rackX, y, wallZ + 14);
          scene.add(board);
          for (let k = 0; k < perRow; k++) {
            place.position.set(rackX - rackW / 2 + 5 + k * 6.3, y + 0.6 + PACK.h / 2, wallZ + 22);
            place.updateMatrix();
            goods.setMatrixAt(goodsCount, place.matrix);
            goods.setColorAt(goodsCount, tone.set(goodsTones[(k * 5 + level * 3) % 6]!));
            goodsCount++;
          }
        }
      }
      scene.add(goods);

      const cabinet = new THREE.Group();
      scene.add(cabinet);
      const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
      const innerMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
      const edgeMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
      const holderMaterial = new THREE.MeshStandardMaterial({ color: "#d5d8dc", roughness: 0.3 });
      const applyFinish = (value: Finish) => {
        bodyMaterial.color.set(FINISH[value].body);
        innerMaterial.color.set(FINISH[value].inner);
        edgeMaterial.color.set(FINISH[value].edge);
      };
      applyFinish(finish);

      const box = (
        w: number,
        h: number,
        d: number,
        material: Three.Material | Three.Material[],
        x: number,
        y: number,
        z: number,
      ) => {
        const mesh = shade(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material));
        mesh.position.set(x, y, z);
        cabinet.add(mesh);
        return mesh;
      };

      // Body: walls, back, top, base with drawers.
      box(SIDE, totalH, DEPTH, bodyMaterial, -bodyW / 2 + SIDE / 2, totalH / 2, 0);
      box(SIDE, totalH, DEPTH, bodyMaterial, bodyW / 2 - SIDE / 2, totalH / 2, 0);
      box(bodyW, totalH, 1, innerMaterial, 0, totalH / 2, -DEPTH / 2 + 0.5);
      box(bodyW, SIDE, DEPTH, bodyMaterial, 0, totalH - SIDE / 2, 0);
      box(bodyW, BASE_H, DEPTH, bodyMaterial, 0, BASE_H / 2, 0);
      const drawerMaterial = new THREE.MeshStandardMaterial({ color: "#000000", roughness: 0.4 });
      drawerMaterial.transparent = true;
      drawerMaterial.opacity = 0.18;
      for (const y of [BASE_H * 0.36, BASE_H * 0.7])
        box(bodyW - SIDE * 2 - 1, 0.4, 0.3, drawerMaterial, 0, y, DEPTH / 2 + 0.2);

      // LED strips along the inner sides and under every shelf.
      const ledMaterial = new THREE.MeshStandardMaterial({
        color: "#ffffff",
        emissive: "#eef6ff",
        emissiveIntensity: 1.6,
      });
      for (const x of [left + 0.3, left + innerW - 0.3])
        box(0.4, shelvesH, 0.6, ledMaterial, x, BASE_H + shelvesH / 2, DEPTH / 2 - 3).castShadow =
          false;

      // Header light box on top (or a tall panel on the side).
      const headerTexture = (w: number, h: number) =>
        header?.image
          ? imageTexture(THREE, header.image)
          : canvasTexture(THREE, Math.round(w * 20), Math.round(h * 20), (ctx) => {
              ctx.fillStyle = header?.color ?? "#1e3a8a";
              ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
              ctx.fillStyle = "#ffffff";
              ctx.textAlign = "center";
              ctx.font = `bold ${Math.round(ctx.canvas.height * 0.28)}px Onest, sans-serif`;
              wrapText(
                ctx,
                header?.name ?? "",
                ctx.canvas.width / 2,
                ctx.canvas.height * 0.45,
                ctx.canvas.width * 0.9,
              );
            });
      if (horizontal) {
        const w = innerW - 1;
        const front = new THREE.MeshStandardMaterial({
          map: headerTexture(w, headerH - 4),
          emissive: "#ffffff",
          emissiveIntensity: 0.6,
        });
        front.emissiveMap = front.map;
        box(
          w,
          headerH - 4,
          8,
          [bodyMaterial, bodyMaterial, bodyMaterial, bodyMaterial, front, bodyMaterial],
          left + innerW / 2,
          totalH - SIDE - headerH / 2,
          DEPTH / 2 - 4,
        );
      }
      if (vertical) {
        const h = shelvesH;
        const front = new THREE.MeshStandardMaterial({
          map: headerTexture(sideHeaderW - 2, h),
          emissive: "#ffffff",
          emissiveIntensity: 0.35,
        });
        front.emissiveMap = front.map;
        box(
          sideHeaderW - 2,
          h,
          6,
          [bodyMaterial, bodyMaterial, bodyMaterial, bodyMaterial, front, bodyMaterial],
          -bodyW / 2 + SIDE + sideHeaderW / 2,
          BASE_H + h / 2,
          DEPTH / 2 - 3,
        );
      }

      // Packs: the picture on the front face only; the other faces in the colour of the
      // picture's edges. Every SKU is one instanced mesh with all its packs on all shelves.
      const packShape = packGeometry(THREE, RoundedBoxGeometry);
      const packLook = { roughness: 0.4, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3 };
      const packFinish: Three.MeshPhysicalMaterial[] = [];
      const packs = new Map<string, { materials: Three.Material[]; at: Placed[] }>();
      const packGroup = (cell: SkuCell) => {
        const id = `${cell.brand}|${cell.name}|${cell.color}|${cell.image ?? ""}`;
        const known = packs.get(id);
        if (known) return known;
        const side = new THREE.MeshPhysicalMaterial({
          ...packLook,
          color: cell.sideColor ?? new THREE.Color(cell.color).multiplyScalar(0.8),
        });
        const map = cell.image
          ? imageTexture(THREE, cell.image, (image) => {
              if (cell.sideColor) return;
              const color = edgeColorOfImage(image);
              if (color) side.color.set(color);
            })
          : canvasTexture(THREE, 128, 198, (ctx) => {
              ctx.fillStyle = cell.color;
              ctx.fillRect(0, 0, 128, 198);
              ctx.fillStyle = "rgba(255,255,255,0.92)";
              ctx.textAlign = "center";
              ctx.font = "bold 22px Onest, sans-serif";
              wrapText(ctx, cell.brand, 64, 46, 116);
              ctx.font = "16px Onest, sans-serif";
              wrapText(ctx, cell.name, 64, 104, 116);
            });
        const front = new THREE.MeshPhysicalMaterial({ ...packLook, map });
        packFinish.push(side, front);
        const group = { materials: [side, front], at: [] as Placed[] };
        packs.set(id, group);
        return group;
      };
      const boardDepth = DEPTH - 2;
      const packFrontZ = boardDepth / 2 - 0.8; // just behind the tag holder
      const rows = depthRows(boardDepth - 4, PACK.d);

      geometry.shelves.forEach((shelf, shelfIndex) => {
        // Shelf boards from the top down; boardY is the top surface the packs stand on.
        const boardY = BASE_H + shelvesH - (shelfIndex + 1) * SHELF_H;
        const shelfLeft = left + MARGIN + shelf.offset * SLOT;
        const shelfW = shelf.slots * SLOT;
        box(
          innerW,
          BOARD_T,
          boardDepth,
          [innerMaterial, innerMaterial, innerMaterial, innerMaterial, edgeMaterial, innerMaterial],
          left + innerW / 2,
          boardY - BOARD_T / 2,
          0,
        );
        // A cool-white LED strip under the board's front edge lights the shelf below.
        box(
          innerW - 1,
          0.3,
          0.6,
          ledMaterial,
          left + innerW / 2,
          boardY - BOARD_T - 0.2,
          DEPTH / 2 - 3,
        ).castShadow = false;

        // The tag holder: a white plastic strip on the board's edge, and a paper tag on it under
        // every facing with a price.
        const holderZ = boardDepth / 2 + 0.25;
        const holderY = boardY - HOLDER_H / 2 + 0.4;
        box(innerW - 0.4, HOLDER_H, 0.5, holderMaterial, left + innerW / 2, holderY, holderZ);
        const prices = Array.from({ length: shelf.slots }, (_, position) => {
          const cell = cells[slotKey(shelfIndex, position)];
          return cell?.kind === "SKU" ? [cell.price, ...cell.badges].filter(Boolean).join(" ") : "";
        });
        if (prices.some(Boolean)) {
          // One canvas per shelf; each tag is a white paper with dark text under its facing.
          const px = 128; // canvas pixels per facing (5.65 × 2.1 cm, the tag's proportions)
          const tags = canvasTexture(THREE, shelf.slots * px, 48, (ctx) => {
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = "700 30px Onest, sans-serif";
            prices.forEach((text, i) => {
              if (!text) return;
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(i * px + 5, 1, px - 10, 46);
              ctx.fillStyle = "#1a1d21";
              ctx.fillText(text, i * px + px / 2, 25, px - 16);
            });
          });
          const tagPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(shelfW, TAG_H),
            new THREE.MeshStandardMaterial({
              map: tags,
              roughness: 0.6,
              alphaTest: 0.5,
              transparent: false,
            }),
          );
          tagPlane.position.set(shelfLeft + shelfW / 2, holderY, holderZ + 0.26);
          tagPlane.receiveShadow = true;
          cabinet.add(tagPlane);
        }

        // The shelftalker: a printed strip hanging under the tag holder, the shelf wide.
        const talker = shelf.talker ? input.shelftalkers?.[shelfIndex] : undefined;
        if (talker) {
          const h = 3.8; // 38 mm
          const map = talker.image
            ? imageTexture(THREE, talker.image)
            : canvasTexture(THREE, Math.round(shelfW * 16), 60, (ctx) => {
                ctx.fillStyle = talker.color;
                ctx.fillRect(0, 0, ctx.canvas.width, 60);
                ctx.fillStyle = "#ffffff";
                ctx.textAlign = "center";
                ctx.font = "bold 34px Onest, sans-serif";
                ctx.fillText(talker.name, ctx.canvas.width / 2, 42, ctx.canvas.width * 0.92);
              });
          const strip = new THREE.Mesh(
            new THREE.PlaneGeometry(shelfW, h),
            new THREE.MeshStandardMaterial({ map, roughness: 0.5 }),
          );
          strip.position.set(
            shelfLeft + shelfW / 2,
            holderY - HOLDER_H / 2 - h / 2,
            holderZ + 0.27,
          );
          cabinet.add(strip);
        }

        // Section dividers (modules of 3 and the like): panels between the packs up to the
        // shelf's front edge, so they show between the front facings.
        if (shelf.group > 0)
          for (let g = shelf.group; g < shelf.slots; g += shelf.group)
            box(
              0.5,
              PACK.h + 1,
              boardDepth - 0.5,
              innerMaterial,
              shelfLeft + g * SLOT,
              boardY + (PACK.h + 1) / 2,
              -0.25,
            );

        for (let position = 0; position < shelf.slots; position++) {
          const cell = cells[slotKey(shelfIndex, position)];
          if (!cell || cell.kind === "EMPTY") continue;
          const x = shelfLeft + position * SLOT;
          if (cell.kind === "SKU") {
            packGroup(cell).at.push(
              ...facingPlacements({
                key: slotKey(shelfIndex, position),
                centerX: x + SLOT / 2,
                frontZ: packFrontZ,
                rows,
                pack: PACK,
              }).map((p) => ({ ...p, y: boardY + PACK.h / 2 })),
            );
          } else {
            // A banner or sticker across its slots.
            const w = cell.span * SLOT - 0.6;
            const map = cell.image
              ? imageTexture(THREE, cell.image)
              : canvasTexture(THREE, Math.round(w * 16), 96, (ctx) => {
                  ctx.fillStyle = cell.color;
                  ctx.fillRect(0, 0, ctx.canvas.width, 96);
                  ctx.fillStyle = "#ffffff";
                  ctx.textAlign = "center";
                  ctx.font = "bold 34px Onest, sans-serif";
                  ctx.fillText(cell.name, ctx.canvas.width / 2, 60, ctx.canvas.width * 0.92);
                });
            const front = new THREE.MeshStandardMaterial({
              map,
              roughness: 0.5,
              emissive: "#ffffff",
              emissiveMap: map,
              emissiveIntensity: 0.12,
            });
            const side = new THREE.MeshStandardMaterial({ color: cell.color, roughness: 0.5 });
            // Over several shelves it hangs down in front of the lower ones.
            const extra = ((cell.rows ?? 1) - 1) * SHELF_H;
            const h = PACK.h * 0.7 + extra;
            box(
              w,
              h,
              0.8,
              [side, side, side, side, front, side],
              x + (cell.span * SLOT) / 2,
              boardY - extra + h / 2,
              packFrontZ - 0.4,
            );
          }
        }
      });

      const turn = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const one = new THREE.Vector3(1, 1, 1);
      const matrix = new THREE.Matrix4();
      for (const { materials, at } of packs.values()) {
        const mesh = shade(new THREE.InstancedMesh(packShape, materials, at.length));
        at.forEach((p, i) => {
          turn.setFromAxisAngle(up, p.yaw);
          mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(p.x, p.y, p.z), turn, one));
        });
        cabinet.add(mesh);
      }

      // Camera: where a shopper stands, eyes at 1.5 m, far enough for the whole display.
      const viewSide: Record<View, number> = { front: 0, left: -0.32, right: 0.32 };
      const setView = (view: View) => {
        const halfTan = Math.tan(((FOV / 2) * Math.PI) / 180);
        const fit = Math.max(
          (totalH * 0.5) / halfTan,
          (bodyW * 0.6) / (halfTan * Math.max(0.3, camera.aspect)),
        );
        const distance = fit + DEPTH / 2;
        const x = viewSide[view] * distance;
        const height = Math.max(EYE_H, center.y);
        camera.position.set(x, height, Math.sqrt(distance * distance - x * x));
        controls.target.copy(center);
        controls.update();
        // The shop fades out from about 4 m behind the display.
        scene.fog = new THREE.Fog(BACKGROUND, distance + 400, distance + 1300);
      };

      // Optional ambient occlusion in the joints, only where the device has power to spare.
      let composer: {
        render: () => void;
        setSize: (w: number, h: number) => void;
        dispose: () => void;
      } | null = null;
      const resize = () => {
        const { clientWidth, clientHeight } = element;
        renderer.setSize(clientWidth, clientHeight);
        composer?.setSize(clientWidth, clientHeight);
        camera.aspect = clientWidth / Math.max(1, clientHeight);
        camera.updateProjectionMatrix();
      };
      resize();
      setView("left");
      api.current = { setView, reset: () => setView("left") };
      const observer = new ResizeObserver(resize);
      observer.observe(element);

      const aoWanted =
        new URLSearchParams(window.location.search).get("ao") ??
        (renderer.capabilities.isWebGL2 && !window.matchMedia("(pointer: coarse)").matches
          ? "auto"
          : "0");
      element.dataset.ao = aoWanted === "1" ? "on" : "off";
      const frameTimes: number[] = [];
      let last = 0;
      const enableAo = async () => {
        const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }] =
          await Promise.all([
            import("three/examples/jsm/postprocessing/EffectComposer.js"),
            import("three/examples/jsm/postprocessing/RenderPass.js"),
            import("three/examples/jsm/postprocessing/GTAOPass.js"),
            import("three/examples/jsm/postprocessing/OutputPass.js"),
          ]);
        if (disposed) return;
        const { clientWidth, clientHeight } = element;
        const effect = new EffectComposer(renderer);
        effect.addPass(new RenderPass(scene, camera));
        const gtao = new GTAOPass(scene, camera, clientWidth, clientHeight);
        gtao.updateGtaoMaterial({ radius: 4, distanceExponent: 1, thickness: 2 });
        gtao.blendIntensity = 0.8;
        effect.addPass(gtao);
        effect.addPass(new OutputPass());
        effect.setSize(clientWidth, clientHeight);
        composer = effect;
        element.dataset.ao = "on";
      };
      if (aoWanted === "1") void enableAo();

      const loop = (now: number) => {
        controls.update();
        if (composer) composer.render();
        else renderer.render(scene, camera);
        if (!element.dataset.firstFrameMs)
          element.dataset.firstFrameMs = String(Math.round(performance.now() - started));
        // Measure the first frames: well above 60 fps → AO (where allowed); below ~33 fps →
        // a lighter picture (fewer pixels, a smaller shadow map, no clearcoat) for weak phones.
        if (frameTimes.length < 20) {
          if (last) frameTimes.push(now - last);
          if (frameTimes.length === 20) {
            const median = [...frameTimes].sort((a, b) => a - b)[10]!;
            if (aoWanted === "auto" && median < 10) void enableAo();
            if (median > 30) {
              renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
              key.shadow.mapSize.set(1024, 1024);
              key.shadow.map?.dispose();
              key.shadow.map = null;
              for (const m of packFinish) m.clearcoat = 0;
              resize();
              element.dataset.quality = "reduced";
            }
          }
        }
        last = now;
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
      setReady(true);
      (element as HTMLDivElement & { applyFinish?: (f: Finish) => void }).applyFinish = applyFinish;

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        composer?.dispose();
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            for (const m of [object.material].flat()) {
              (m as Three.MeshStandardMaterial).map?.dispose();
              m.dispose();
            }
          }
        });
        environment.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })().catch(() => {
      if (!disposed) setFailed(true);
    });

    return () => {
      disposed = true;
      cleanup();
    };
    // The scene is built once per planogram; the finish changes materials in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  useEffect(() => {
    (
      host.current as (HTMLDivElement & { applyFinish?: (f: Finish) => void }) | null
    )?.applyFinish?.(finish);
  }, [finish, ready]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-secondary/70 inline-flex gap-0.5 rounded-full p-1 text-sm">
          {(["left", "front", "right"] as const).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => api.current?.setView(view)}
              className="hover:bg-card rounded-full px-3 py-1"
            >
              {t(`planograms.view3d.${view}`)}
            </button>
          ))}
        </div>
        <div className="bg-secondary/70 inline-flex gap-0.5 rounded-full p-1 text-sm">
          {(["dark", "light"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFinish(value)}
              className={cn(
                "rounded-full px-3 py-1",
                finish === value ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
              )}
            >
              {t(`planograms.view3d.${value}`)}
            </button>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => api.current?.reset()}>
          <RotateCcw />
          {t("planograms.view3d.reset")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void host.current?.requestFullscreen?.()}
        >
          <Maximize2 />
          {t("planograms.view3d.fullscreen")}
        </Button>
      </div>
      <div
        ref={host}
        className="bg-muted relative h-[70vh] min-h-[420px] w-full touch-none overflow-hidden rounded-2xl border"
      >
        {failed ? (
          <div className="text-muted-foreground absolute inset-0 flex items-center justify-center p-6 text-center text-sm">
            {t("planograms.view3d.failed")}
          </div>
        ) : (
          !ready && (
            <div className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm">
              <Box className="size-4 animate-pulse" />
              {t("planograms.view3d.loading")}
            </div>
          )
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t("planograms.view3d.hint")}</p>
    </div>
  );
}
