"use client";

import { Box, Maximize2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as Three from "three";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { slotKey, widthInSlots } from "@/modules/planograms/geometry";
import type { RenderInput } from "@/modules/planograms/render";

// The planogram on its equipment in 3D, like the real display cabinets: a light box header
// on top, shelves with packs, coloured price rails, a base with drawers. Sizes in centimetres.
const SLOT = 6.2; // one facing
const PACK = { w: 5.4, h: 8.6, d: 6.6 }; // a row of packs, seen from the front
const SHELF_H = 13; // shelf to shelf
const RAIL_H = 2.4; // the price rail on the front edge
const SIDE = 2; // cabinet walls
const DEPTH = 32;
const BASE_H = 42;
const HEADER_H = 22;
const MARGIN = 1.6;

// Rail colours, top to bottom, as on the cabinets in the shops.
const RAILS = ["#2563eb", "#dc2626", "#16a34a", "#0284c7", "#9333ea", "#ea580c", "#0d9488"];

type View = "front" | "left" | "right";
type Finish = "dark" | "light";

type ThreeModule = typeof Three;

// A canvas with text, used as a texture (pack fronts without a picture, rails, header).
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

function imageTexture(THREE: ThreeModule, src: string) {
  const texture = new THREE.TextureLoader().load(src);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function Planogram3D({ input }: { input: RenderInput }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ setView: (v: View) => void; reset: () => void } | null>(null);
  const [finish, setFinish] = useState<Finish>("dark");
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
      const THREE = await import("three");
      if (disposed) return;
      if (!webglAvailable()) throw new Error("webgl");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed) return;

      const { geometry, cells, header } = input;
      const vertical = geometry.header === "vertical" && header;
      const horizontal = geometry.header === "horizontal" && header;
      const slots = widthInSlots(geometry);
      const innerW = slots * SLOT + MARGIN * 2;
      const sideHeaderW = vertical ? 14 : 0;
      const shelvesH = geometry.shelves.length * SHELF_H + 4;
      const bodyW = innerW + SIDE * 2 + sideHeaderW;
      const totalH = BASE_H + shelvesH + (horizontal ? HEADER_H + 2 : 3);
      const left = -bodyW / 2 + SIDE + sideHeaderW; // inner left edge

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#eef0f3");
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      element.appendChild(renderer.domElement);

      const camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.minDistance = 40;
      controls.maxDistance = 600;
      controls.maxPolarAngle = Math.PI * 0.55;
      const center = new THREE.Vector3(0, totalH * 0.55, 0);
      controls.target.copy(center);

      // Light: soft room light, a key light from the front, a fill from the side.
      scene.add(new THREE.HemisphereLight("#ffffff", "#c7cbd3", 1.6));
      const key = new THREE.DirectionalLight("#ffffff", 1.6);
      key.position.set(-60, totalH * 1.6, 160);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -150, right: 150, top: 300, bottom: -50 });
      scene.add(key);
      const fill = new THREE.DirectionalLight("#ffffff", 0.5);
      fill.position.set(120, totalH, 60);
      scene.add(fill);

      // Floor and wall.
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(1200, 1200),
        new THREE.MeshStandardMaterial({ color: "#c9d2e3", roughness: 0.95 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(1200, 600),
        new THREE.MeshStandardMaterial({ color: "#e7e2da", roughness: 1 }),
      );
      wall.position.set(0, 300, -DEPTH / 2 - 6);
      wall.receiveShadow = true;
      scene.add(wall);

      const cabinet = new THREE.Group();
      scene.add(cabinet);
      const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 });
      const innerMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8 });
      const applyFinish = (value: Finish) => {
        bodyMaterial.color.set(value === "dark" ? "#1f2329" : "#f3f4f6");
        innerMaterial.color.set(value === "dark" ? "#2b3038" : "#ffffff");
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
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
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
          map: headerTexture(w, HEADER_H - 4),
          emissive: "#ffffff",
          emissiveIntensity: 0.35,
        });
        front.emissiveMap = front.map;
        box(
          w,
          HEADER_H - 4,
          8,
          [bodyMaterial, bodyMaterial, bodyMaterial, bodyMaterial, front, bodyMaterial],
          left + innerW / 2,
          totalH - SIDE - HEADER_H / 2,
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

      // Pack fronts: the picture, or a coloured card with the brand and the name.
      const packMaterials = new Map<string, Three.Material[]>();
      const packMaterial = (cell: Extract<RenderInput["cells"][string], { kind: "SKU" }>) => {
        const id = `${cell.brand}|${cell.name}|${cell.color}|${cell.image ? 1 : 0}`;
        const known = packMaterials.get(id);
        if (known) return known;
        const map = cell.image
          ? imageTexture(THREE, cell.image)
          : canvasTexture(THREE, 128, 204, (ctx) => {
              ctx.fillStyle = cell.color;
              ctx.fillRect(0, 0, 128, 204);
              ctx.fillStyle = "rgba(255,255,255,0.92)";
              ctx.textAlign = "center";
              ctx.font = "bold 22px Onest, sans-serif";
              wrapText(ctx, cell.brand, 64, 46, 116);
              ctx.font = "16px Onest, sans-serif";
              wrapText(ctx, cell.name, 64, 104, 116);
            });
        const sideColor = new THREE.Color(cell.color).multiplyScalar(0.75);
        const side = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.5 });
        const front = new THREE.MeshStandardMaterial({ map, roughness: 0.45 });
        const materials = [side, side, side, side, front, side];
        packMaterials.set(id, materials);
        return materials;
      };

      geometry.shelves.forEach((shelf, shelfIndex) => {
        // Shelf boards from the top down; packs stand on the board.
        const boardY = BASE_H + shelvesH - (shelfIndex + 1) * SHELF_H;
        const shelfLeft = left + MARGIN + shelf.offset * SLOT;
        const shelfW = shelf.slots * SLOT;
        box(innerW, 0.8, DEPTH - 2, innerMaterial, left + innerW / 2, boardY, 0);

        // The price rail with a tag under every facing.
        const railColor = RAILS[shelfIndex % RAILS.length]!;
        const prices = Array.from({ length: shelf.slots }, (_, position) => {
          const cell = cells[slotKey(shelfIndex, position)];
          return cell?.kind === "SKU" ? [cell.price, ...cell.badges].filter(Boolean).join(" ") : "";
        });
        const rail = canvasTexture(THREE, Math.max(64, shelf.slots * 96), 40, (ctx) => {
          const gradient = ctx.createLinearGradient(0, 0, ctx.canvas.width, 0);
          gradient.addColorStop(0, railColor);
          gradient.addColorStop(1, new THREE.Color(railColor).offsetHSL(0.08, 0, 0.08).getStyle());
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, ctx.canvas.width, 40);
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.font = "bold 20px Onest, sans-serif";
          prices.forEach((text, i) => text && ctx.fillText(text, i * 96 + 48, 27, 92));
        });
        const railFront = new THREE.MeshStandardMaterial({
          map: rail,
          emissive: "#ffffff",
          emissiveMap: rail,
          emissiveIntensity: 0.25,
        });
        const railSide = new THREE.MeshStandardMaterial({ color: railColor });
        box(
          shelfW,
          RAIL_H,
          0.6,
          [railSide, railSide, railSide, railSide, railFront, railSide],
          shelfLeft + shelfW / 2,
          boardY - RAIL_H / 2 + 0.4,
          DEPTH / 2 - 1,
        );

        // Group separators (modules of 3 and the like).
        if (shelf.group > 0)
          for (let g = shelf.group; g < shelf.slots; g += shelf.group)
            box(
              0.25,
              PACK.h + 1,
              DEPTH - 6,
              innerMaterial,
              shelfLeft + g * SLOT,
              boardY + (PACK.h + 1) / 2 + 0.4,
              0,
            );

        for (let position = 0; position < shelf.slots; position++) {
          const cell = cells[slotKey(shelfIndex, position)];
          if (!cell || cell.kind === "EMPTY") continue;
          const x = shelfLeft + position * SLOT;
          if (cell.kind === "SKU") {
            box(
              PACK.w,
              PACK.h,
              PACK.d,
              packMaterial(cell),
              x + SLOT / 2,
              boardY + 0.4 + PACK.h / 2,
              DEPTH / 2 - 2 - PACK.d / 2,
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
              emissive: "#ffffff",
              emissiveMap: map,
              emissiveIntensity: 0.15,
            });
            const side = new THREE.MeshStandardMaterial({ color: cell.color });
            box(
              w,
              PACK.h * 0.7,
              0.8,
              [side, side, side, side, front, side],
              x + (cell.span * SLOT) / 2,
              boardY + 0.4 + PACK.h * 0.35,
              DEPTH / 2 - 2.5,
            );
          }
        }
      });

      // Camera positions.
      const distance = Math.max(totalH, bodyW) * 1.9;
      const views: Record<View, Three.Vector3> = {
        front: new THREE.Vector3(0, center.y + 10, distance),
        left: new THREE.Vector3(-distance * 0.62, center.y + 25, distance * 0.78),
        right: new THREE.Vector3(distance * 0.62, center.y + 25, distance * 0.78),
      };
      const setView = (view: View) => {
        camera.position.copy(views[view]);
        controls.target.copy(center);
        controls.update();
      };
      setView("left");
      api.current = { setView, reset: () => setView("left") };

      const resize = () => {
        const { clientWidth, clientHeight } = element;
        renderer.setSize(clientWidth, clientHeight);
        camera.aspect = clientWidth / Math.max(1, clientHeight);
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(element);

      const loop = () => {
        controls.update();
        renderer.render(scene, camera);
        frame = requestAnimationFrame(loop);
      };
      loop();
      setReady(true);
      (element as HTMLDivElement & { applyFinish?: (f: Finish) => void }).applyFinish = applyFinish;

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            for (const m of [object.material].flat()) {
              (m as Three.MeshStandardMaterial).map?.dispose();
              m.dispose();
            }
          }
        });
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
