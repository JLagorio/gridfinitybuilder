import { beforeEach, describe, expect, it } from 'vitest';
import { applyHomography, type Mat3 } from '../src/lib/trace/homography';
import type { Pt } from '../src/lib/trace/image';
import { cleanWall, type WallPhoto } from '../src/lib/wallPlanner/data';
import {
  MAX_PHOTO_SIDE,
  PHOTO_PAPERS,
  centredAt,
  cleanPhoto,
  findSheet,
  findWall,
  goodQuad,
  insetCorners,
  mapPoint,
  newPhoto,
  paperSize,
  photoDetail,
  photoOutline,
  photoRegion,
  photoToWall,
  rectCorners,
  refRect,
  wallToPhoto,
  warpPhoto,
  type WarpedPhoto,
} from '../src/lib/wallPlanner/photo';
import { adoptPhotos, isPhotoHash, isPhotoMissing, keepPhoto, loadPhoto, photoBytes, photoHash, withWallPhoto } from '../src/lib/wallPlanner/photoStore';
import { history, projectFile, useStore } from '../src/state/store';
import { setWall } from '../src/state/wallPlanner';
import { currentPhoto, setPhotoView, setWallPhoto } from '../src/state/wallPhoto';
import { decodeProject, encodeProject, openQuestion, shareUrl, projectFromHash } from '../src/lib/share';
import { shareableProject } from '../src/lib/externalShare';
import { SCENE_SHEET, SCENE_SOCKET, SCENE_WALL, SCENE_WINDOW, sceneCorners, scenePhoto, scenePoint } from './wallPhotoScene';

const s = () => useStore.getState();
const near = (a: Pt, b: Pt, tol: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
const map = (H: Mat3, p: Pt) => applyHomography(H, p);
/** The resampled photo's pixel at wall mm (x, y): RGBA. */
const pixel = (w: WarpedPhoto, x: number, y: number) => {
  const o = (Math.floor((w.rect.y + w.rect.h - y) * w.ppm) * w.image.width + Math.floor((x - w.rect.x) * w.ppm)) * 4;
  return [...w.image.data.slice(o, o + 4)];
};

/** The scene's photo lined up by the wall's corners, where they are exactly. */
const byWall = (w = 1200): WallPhoto => ({
  hash: '',
  name: 'wall.jpg',
  w,
  h: Math.round((w * 2) / 3),
  corners: sceneCorners(w),
  ref: 'wall',
  paper: 'a4',
  across: false,
  at: [0, 0],
  opacity: 0.7,
  hidden: false,
});

/** The same photo lined up by the A4 sheet on the wall, with its bottom-left corner where it is. */
const S = SCENE_SHEET;
const bySheet = (w = 1200): WallPhoto => ({
  ...byWall(w),
  ref: 'paper',
  corners: [scenePoint(S.x, S.y + S.h, w), scenePoint(S.x + S.w, S.y + S.h, w), scenePoint(S.x + S.w, S.y, w), scenePoint(S.x, S.y, w)],
  at: [S.x, S.y],
});

// One rendering of the scene for the image tests (it takes a moment).
const PHOTO = scenePhoto(900);

describe('lining a photo up with the wall', () => {
  it('maps the four corners onto the wall’s corners, and back', () => {
    const p = byWall();
    const H = photoToWall(p, SCENE_WALL);
    const want = rectCorners({ x: 0, y: 0, w: SCENE_WALL.width, h: SCENE_WALL.height });
    p.corners.forEach((c, i) => expect(near(map(H, c), want[i], 1e-6)).toBe(true));
    // Top left in the photo is the wall's top left: y up on the wall.
    expect(want[0]).toEqual([0, SCENE_WALL.height]);
    // Round trips: wall → photo → wall, and photo → wall → photo.
    const back = wallToPhoto(p, SCENE_WALL);
    for (const pt of [
      [100, 200],
      [1234.5, 777],
      [2399, 1],
      [-300, 1700],
    ] as Pt[])
      expect(near(map(H, map(back, pt)), pt, 1e-6)).toBe(true);
    for (const pt of [
      [0, 0],
      [600, 400],
      [1199, 799],
    ] as Pt[])
      expect(near(map(back, map(H, pt)), pt, 1e-6)).toBe(true);
  });

  it('finds what is on the wall where it is: the window, the socket, the sheet', () => {
    const H = photoToWall(byWall(), SCENE_WALL);
    const W = SCENE_WINDOW;
    for (const [x, y] of [
      [W.x, W.y],
      [W.x + W.w, W.y + W.h],
      [SCENE_SOCKET.x + 40, SCENE_SOCKET.y + 40],
      [S.x + S.w, S.y],
    ] as Pt[])
      expect(near(map(H, scenePoint(x, y)), [x, y], 1e-6)).toBe(true);
  });

  it('takes the scale from the sheet’s known size', () => {
    // The sheet's corners and where it is on the wall: everything else follows, the wall's own corners included.
    const H = photoToWall(bySheet(), SCENE_WALL);
    sceneCorners().forEach((c, i) => expect(near(map(H, c), rectCorners({ x: 0, y: 0, w: SCENE_WALL.width, h: SCENE_WALL.height })[i], 0.01)).toBe(true));
    // The window's width is measured right, two metres from the sheet.
    const a = map(H, scenePoint(SCENE_WINDOW.x, SCENE_WINDOW.y));
    const b = map(H, scenePoint(SCENE_WINDOW.x + SCENE_WINDOW.w, SCENE_WINDOW.y));
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(SCENE_WINDOW.w, 2);
    // Said to be Letter, the same handles make everything Letter's width over A4's as wide.
    const letter = photoToWall({ ...bySheet(), paper: 'letter', at: [0, 0] }, SCENE_WALL);
    const a4 = photoToWall({ ...bySheet(), at: [0, 0] }, SCENE_WALL);
    const [l0, l1] = [map(letter, scenePoint(1350, 650)), map(letter, scenePoint(2200, 650))];
    const [f0, f1] = [map(a4, scenePoint(1350, 650)), map(a4, scenePoint(2200, 650))];
    expect((l1[0] - l0[0]) / (f1[0] - f0[0])).toBeCloseTo(PHOTO_PAPERS.letter.w / PHOTO_PAPERS.a4.w, 6);
    // Moving the sheet on the wall moves the whole photo with it.
    const moved = photoToWall({ ...bySheet(), at: [S.x + 100, S.y - 50] }, SCENE_WALL);
    const p = map(moved, scenePoint(1000, 500));
    expect(p[0]).toBeCloseTo(1100, 6);
    expect(p[1]).toBeCloseTo(450, 6);
  });

  it('knows a sheet upright from one across, and A4 from Letter', () => {
    expect(paperSize({ paper: 'a4', across: false })).toEqual({ w: 210, h: 297 });
    expect(paperSize({ paper: 'a4', across: true })).toEqual({ w: 297, h: 210 });
    expect(paperSize({ paper: 'letter', across: false })).toEqual({ w: 215.9, h: 279.4 });
    expect(refRect({ ref: 'paper', paper: 'letter', across: true, at: [10, 20] }, SCENE_WALL)).toEqual({ x: 10, y: 20, w: 279.4, h: 215.9 });
    expect(refRect({ ref: 'wall', paper: 'letter', across: true, at: [10, 20] }, SCENE_WALL)).toEqual({ x: 0, y: 0, w: 2400, h: 1500 });
  });

  it('says where the photo reaches on the wall, and nothing past the horizon', () => {
    const p = byWall();
    const o = photoOutline(p, SCENE_WALL)!;
    expect(o).toHaveLength(4);
    // The photo shows more than the wall: its outline is round it.
    expect(Math.min(...o.map((q) => q[0]))).toBeLessThan(0);
    expect(Math.max(...o.map((q) => q[1]))).toBeGreaterThan(SCENE_WALL.height);
    const clip = { x: -100, y: -100, w: 2600, h: 1700 };
    expect(photoRegion(p, SCENE_WALL, clip)).toEqual(clip);
    // A sheet far off the wall: the photo covers none of the view.
    expect(photoRegion({ ...bySheet(), at: [30000, 30000] }, SCENE_WALL, clip)).toBeNull();
    // A wall seen at a steep angle: its horizon runs through the photo, and points beyond it don't map.
    const steep: WallPhoto = {
      ...p,
      corners: [
        [500, 300],
        [700, 380],
        [700, 420],
        [500, 500],
      ],
    };
    const H = photoToWall(steep, SCENE_WALL);
    expect(mapPoint(H, [600, 400], steep.corners)).not.toBeNull();
    expect(mapPoint(H, [1190, 400], steep.corners)).toBeNull();
    expect(photoOutline(steep, SCENE_WALL)).toBeNull();
    // Then the region is the whole view, and the warp leaves what it can't map clear.
    expect(photoRegion(steep, SCENE_WALL, clip)).toEqual(clip);
  });

  it('tells good handles from crossed ones', () => {
    expect(goodQuad(sceneCorners())).toBe(true);
    const [tl, tr, br, bl] = sceneCorners();
    expect(goodQuad([tr, tl, bl, br])).toBe(false); // mirrored
    expect(goodQuad([tl, tr, bl, br])).toBe(false); // twisted
    expect(goodQuad([tl, tl, br, bl])).toBe(false);
    expect(goodQuad([tl, tr, br])).toBe(false);
    expect(goodQuad([tl, tr, [NaN, 1], bl])).toBe(false);
    expect(goodQuad(insetCorners(800, 600))).toBe(true);
  });

  it('resamples the photo onto the wall: the sheet white, the glass blue, clear past the photo', () => {
    const p = byWall(900);
    const rect = { x: -200, y: -200, w: 2800, h: 1900 };
    const w = warpPhoto(PHOTO, p, SCENE_WALL, rect, 400_000);
    expect(w.image.width * w.image.height).toBeLessThanOrEqual(400_000 * 1.01);
    expect(w.ppm).toBeCloseTo(w.image.width / rect.w, 6);
    const at = (x: number, y: number) => pixel(w, x, y);
    const sheet = at(S.x + S.w / 2, S.y + S.h / 2);
    expect(Math.min(...sheet.slice(0, 3))).toBeGreaterThan(235);
    const glass = at(SCENE_WINDOW.x + 200, SCENE_WINDOW.y + 300);
    expect(glass[2] - glass[0]).toBeGreaterThan(30);
    const wall = at(800, 500);
    expect(wall).toEqual([181, 163, 136, 255]);
    // Past the photo's edge: nothing. (Lined up by the sheet, said to be 1.5 m further right, the photo starts past the wall's middle.)
    const right = warpPhoto(PHOTO, { ...bySheet(900), at: [S.x + 1500, S.y] }, SCENE_WALL, rect, 400_000);
    expect(pixel(right, 500, 500)[3]).toBe(0);
    expect(pixel(right, 2300, 500)[3]).toBe(255);
    // Its detail: the photo's pixels per wall mm round the wall (about 0.3 at 900 px across 2.4 m).
    expect(photoDetail(p, SCENE_WALL)).toBeGreaterThan(0.25);
    expect(photoDetail(p, SCENE_WALL)).toBeLessThan(0.45);
    // A photo decoded at another size than it was lined up at: the corners scale with it.
    const half = warpPhoto(scenePhoto(450), p, SCENE_WALL, rect, 400_000);
    expect(pixel(half, S.x + S.w / 2, S.y + S.h / 2)[0]).toBeGreaterThan(230);
    expect(Math.abs(pixel(half, 800, 500)[0] - 181)).toBeLessThan(4);
  });

  it('finds the sheet on the wall to start the handles, and the wall', () => {
    const sheet = findSheet(PHOTO)!;
    expect(sheet).not.toBeNull();
    const want = bySheet(900).corners;
    // Found on a smaller copy, then made exact on the photo: within a pixel.
    sheet.forEach((c, i) => expect(near(c, want[i], 1)).toBe(true));
    // So lined up by it, the wall's far corners land within 1.5% of the wall's width (they're ten sheets away).
    const H = photoToWall({ ...bySheet(900), corners: sheet }, SCENE_WALL);
    for (const [x, y] of [
      [0, 0],
      [2400, 0],
      [2400, 1500],
      [0, 1500],
    ] as Pt[])
      expect(near(map(H, scenePoint(x, y, 900)), [x, y], 36)).toBe(true);
    const wall = findWall(PHOTO)!;
    // Its top corners; the bottom ones above the skirting board (the handles are dragged from there).
    expect(near(wall[0], sceneCorners(900)[0], 6)).toBe(true);
    expect(near(wall[1], sceneCorners(900)[1], 6)).toBe(true);
    expect(goodQuad(wall)).toBe(true);
    // A new photo starts lined up by the sheet, upright, with the photo in the middle of the wall.
    const p = newPhoto('', 'wall.jpg', PHOTO, SCENE_WALL);
    expect(p.ref).toBe('paper');
    expect(p.across).toBe(false);
    expect(p.at).toEqual(centredAt(p, SCENE_WALL));
    const mid = map(photoToWall(p, SCENE_WALL), [450, 300]);
    expect(Math.abs(mid[0] - 1200)).toBeLessThan(1);
    expect(Math.abs(mid[1] - 750)).toBeLessThan(1);
    // A plain photo, nothing like a sheet in it: by the wall, 12% in from the edges.
    const blank = { width: 300, height: 200, data: new Uint8ClampedArray(300 * 200 * 4).fill(128) };
    expect(findSheet(blank)).toBeNull();
    const q = newPhoto('', '', blank, SCENE_WALL);
    expect(q.ref).toBe('wall');
    expect(q.corners).toEqual(insetCorners(300, 200));
  });
});

describe('keeping the photo', () => {
  it('cleans a saved photo', () => {
    for (const v of [undefined, null, 3, 'photo', [], { w: 0, h: 10 }, { w: 10 }]) expect(cleanPhoto(v)).toBeUndefined();
    const p = cleanPhoto({
      hash: 'not a hash',
      name: 'x'.repeat(200),
      w: 9999.4,
      h: '600',
      corners: [[1, 2], [3]],
      ref: 'ceiling',
      paper: 'a3',
      across: 'yes',
      at: [1e9, 'up'],
      opacity: 7,
      hidden: 1,
    })!;
    expect(p).toEqual({
      hash: '',
      name: 'x'.repeat(80),
      w: 8192,
      h: 600,
      corners: insetCorners(8192, 600),
      ref: 'wall',
      paper: 'a4',
      across: false,
      at: [40000, 0],
      opacity: 1,
      hidden: false,
    });
    // A good one comes back as it was (corners may lie past the photo's edges, up to its size).
    const good = {
      ...bySheet(),
      hash: 'a'.repeat(28),
      corners: [
        [-300, 10],
        [1100, 5],
        [1150, 700],
        [-200, 790],
      ] as Pt[],
    };
    expect(cleanPhoto(good)).toEqual(good);
    expect(
      cleanPhoto({
        ...good,
        corners: [
          [-3000, 10],
          [1100, 5],
          [1150, 700],
          [-200, 790],
        ],
      })!.corners[0],
    ).toEqual([-1200, 10]);
    // Crossed handles start again.
    expect(cleanPhoto({ ...good, corners: [good.corners[1], good.corners[0], good.corners[3], good.corners[2]] })!.corners).toEqual(insetCorners(1200, 800));
    expect(cleanPhoto({ ...good, opacity: 0 })!.opacity).toBe(0.1);
  });

  it('keeps the wall’s photo as it came on the first screen, and cleans it where it’s used', () => {
    const raw = { ...byWall(), junk: 1 };
    expect(cleanWall({ width: 2000, photo: raw })!.photo).toBe(raw);
    expect(cleanWall({ width: 2000, photo: 'nope' })).not.toHaveProperty('photo');
    expect(cleanWall({ width: 2000 })).not.toHaveProperty('photo');
  });

  it('stores photos by content: the same bytes, the same hash', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5, 6, 7]);
    const { hash, saved } = keepPhoto(bytes, 'a.jpg');
    expect(isPhotoHash(hash)).toBe(true);
    expect(photoHash(bytes.slice())).toBe(hash);
    expect(photoHash(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5, 6, 8]))).not.toBe(hash);
    expect(photoBytes(hash)).toBe(bytes);
    expect(await loadPhoto(hash)).toBe(bytes);
    // No IndexedDB here: it's kept for this visit only.
    expect(await saved).toBe(false);
    // One this browser hasn't got.
    const other = 'b'.repeat(28);
    expect(await loadPhoto(other)).toBeNull();
    expect(isPhotoMissing(other)).toBe(true);
    expect(await loadPhoto('')).toBeNull();
  });

  it('is never bigger than 2048 px on its long side', () => {
    expect(MAX_PHOTO_SIDE).toBe(2048);
  });
});

describe('the photo in the project', () => {
  beforeEach(() => s().resetAll());
  const bytes = new Uint8Array(Array.from({ length: 3000 }, (_, i) => (i * 7) % 256));

  it('puts it behind the wall, lines it up again and takes it away: one undo step each', () => {
    setWall({ width: SCENE_WALL.width, height: SCENE_WALL.height });
    const { hash } = keepPhoto(bytes, 'wall.jpg');
    setWallPhoto({ ...bySheet(), hash });
    expect(currentPhoto()).toEqual(cleanPhoto({ ...bySheet(), hash }));
    // Editing the corners.
    const moved = bySheet().corners.map(([x, y]) => [x + 5, y] as Pt);
    setWallPhoto({ ...currentPhoto()!, corners: moved, paper: 'letter' });
    expect(currentPhoto()!.corners).toEqual(moved.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]));
    history.undo();
    expect(currentPhoto()!.corners).toEqual(bySheet().corners.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]));
    expect(currentPhoto()!.paper).toBe('a4');
    // Moving it, hiding it.
    setPhotoView({ at: [500, 900] });
    setPhotoView({ hidden: true });
    expect(currentPhoto()).toMatchObject({ at: [500, 900], hidden: true });
    history.undo();
    expect(currentPhoto()).toMatchObject({ at: [500, 900], hidden: false });
    history.undo();
    expect(currentPhoto()!.at).toEqual([S.x, S.y]);
    // Taking it away, and back.
    setWallPhoto(undefined);
    expect(s().wall).not.toHaveProperty('photo');
    expect(s().wall!.width).toBe(SCENE_WALL.width);
    history.undo();
    expect(currentPhoto()!.hash).toBe(hash);
    // Setting it in the first place.
    history.undo();
    history.undo();
    expect(s().wall?.photo).toBeUndefined();
  });

  it('goes in the project file with its bytes, and comes back from it', async () => {
    const { hash } = keepPhoto(bytes, 'wall.jpg');
    setWallPhoto({ ...byWall(), hash, opacity: 0.45 });
    const file = await withWallPhoto(projectFile(s()));
    expect(Object.keys(file.photos!)).toEqual([hash]);
    const text = JSON.stringify(file);
    s().resetAll();
    const data = JSON.parse(text);
    expect(adoptPhotos(data.photos)).toBe(1);
    s().loadProject(data);
    expect(currentPhoto()).toEqual({ ...byWall(), hash, opacity: 0.45 });
    expect([...(await loadPhoto(hash))!]).toEqual([...bytes]);
    // Bytes that don't match their hash, or aren't bytes, are skipped.
    expect(adoptPhotos({ [hash]: data.photos[hash].slice(0, -4) })).toBe(0);
    expect(adoptPhotos({ nothash: data.photos[hash], [hash]: 5 })).toBe(0);
    expect(adoptPhotos('photos')).toBe(0);
    // A wall without a photo, or one this browser hasn't got: no bytes in the file.
    s().resetAll();
    expect(await withWallPhoto(projectFile(s()))).not.toHaveProperty('photos');
    setWallPhoto({ ...byWall(), hash: 'c'.repeat(28) });
    expect(await withWallPhoto(projectFile(s()))).not.toHaveProperty('photos');
  });

  it('stays behind when the project goes in a share link, and opening the link says so', () => {
    const { hash } = keepPhoto(bytes, 'wall.jpg');
    setWall({ width: SCENE_WALL.width, height: SCENE_WALL.height });
    setWallPhoto({ ...bySheet(), hash });
    const shared = shareableProject(projectFile(s()));
    expect(shared.photo).toBe(true);
    expect(shared.file.wall!.photo).toEqual(cleanPhoto(bySheet()));
    expect(shared.file).not.toHaveProperty('photos');
    // The project itself keeps its photo.
    expect(currentPhoto()!.hash).toBe(hash);
    const url = shareUrl(shared.file, 'https://gridfit.example/');
    expect(url).not.toContain(hash);
    const data = projectFromHash(new URL(url).hash);
    expect(openQuestion(data)).toMatch(/^Open the project from this link\?.* The photo of the wall stayed behind: links don’t carry photos\.$/);
    s().resetAll();
    s().loadProject(data);
    // How it was lined up comes along, without the photo: the planner offers to pick it again.
    expect(currentPhoto()).toEqual(cleanPhoto(bySheet()));
    // A link from a project without a photo says nothing about one.
    s().resetAll();
    const plain = shareableProject(projectFile(s()));
    expect(plain.photo).toBe(false);
    expect(openQuestion(decodeProject(encodeProject(plain.file)))).not.toMatch(/photo/);
    expect(openQuestion(null)).toBeNull();
  });
});
