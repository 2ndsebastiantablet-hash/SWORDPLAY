export type Vec2 = {
  x: number;
  y: number;
};

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return vec2(a.x + b.x, a.y + b.y);
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return vec2(a.x - b.x, a.y - b.y);
}

export function scale(v: Vec2, amount: number): Vec2 {
  return vec2(v.x * amount, v.y * amount);
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lengthSq(v: Vec2): number {
  return dot(v, v);
}

export function length(v: Vec2): number {
  return Math.sqrt(lengthSq(v));
}

export function distance(a: Vec2, b: Vec2): number {
  return length(sub(a, b));
}

export function normalize(v: Vec2, fallback: Vec2 = vec2(0, 0)): Vec2 {
  const size = length(v);
  if (size < 0.0001) {
    return vec2(fallback.x, fallback.y);
  }
  return scale(v, 1 / size);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return vec2(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
}

export function moveToward(current: Vec2, target: Vec2, maxDelta: number): Vec2 {
  const delta = sub(target, current);
  const size = length(delta);
  if (size <= maxDelta || size < 0.0001) {
    return vec2(target.x, target.y);
  }
  return add(current, scale(delta, maxDelta / size));
}

export function perpendicularLeft(v: Vec2): Vec2 {
  return vec2(-v.y, v.x);
}

export function perpendicularRight(v: Vec2): Vec2 {
  return vec2(v.y, -v.x);
}

export function fromAngle(angle: number): Vec2 {
  return vec2(Math.cos(angle), Math.sin(angle));
}

export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

export function project(a: Vec2, onto: Vec2): Vec2 {
  const unit = normalize(onto);
  return scale(unit, dot(a, unit));
}

export function reject(a: Vec2, onto: Vec2): Vec2 {
  return sub(a, project(a, onto));
}

export function clampMagnitude(v: Vec2, maxLength: number): Vec2 {
  const size = length(v);
  if (size <= maxLength) {
    return vec2(v.x, v.y);
  }
  return scale(v, maxLength / Math.max(size, 0.0001));
}

export function signedSide(forward: Vec2, pointDelta: Vec2): number {
  return dot(perpendicularRight(forward), pointDelta);
}

export function closestPointOnSegment(point: Vec2, a: Vec2, b: Vec2): Vec2 {
  const segment = sub(b, a);
  const t = clamp(dot(sub(point, a), segment) / Math.max(lengthSq(segment), 0.0001), 0, 1);
  return add(a, scale(segment, t));
}

export function distancePointToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  return distance(point, closestPointOnSegment(point, a, b));
}

function segmentIntersects(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const a = sub(a2, a1);
  const b = sub(b2, b1);
  const originDelta = sub(b1, a1);
  const denominator = cross(a, b);
  if (Math.abs(denominator) < 0.0001) {
    return false;
  }
  const t = cross(originDelta, b) / denominator;
  const u = cross(originDelta, a) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function distanceSegmentToSegment(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number {
  if (segmentIntersects(a1, a2, b1, b2)) {
    return 0;
  }
  const samples = [
    distancePointToSegment(a1, b1, b2),
    distancePointToSegment(a2, b1, b2),
    distancePointToSegment(b1, a1, a2),
    distancePointToSegment(b2, a1, a2),
  ];
  return Math.min(...samples);
}
