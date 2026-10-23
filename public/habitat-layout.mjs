// Shared physical placement: heights are the actual support surfaces, in metres.
export const FOOD_TOP = 1.025;
export const FOOD_PROPS = Object.freeze({
  water: { x: -2.82, z: .56, radius: .34 },
  fruit: { x: -3.08, z: 1.59, radius: .36 },
  bottle: { x: -3.93, z: 1.34, radius: .18 },
  fig: { x: -3.62, z: 2.24, radius: .27 },
});
export const PERCH_POST = Object.freeze({ x: 5.22, z: .06, width: .18, height: 2.59 });
export const PERCH_PLATFORMS = Object.freeze([
  { x: 4.95, y: 1.25, z: -.15, width: 1, depth: .7 },
  { x: 5, y: 2.52, z: .2, width: .9, depth: .7 },
]);
export const GARDEN_TOP = .72;
export const GARDEN_POOL = Object.freeze({ x: 4.65, z: -2.36, radius: .39 });
// Open ring interiors are deliberately wider than the complete fly envelope.
export const GARDEN_RINGS = Object.freeze([]);
export const TERRARIUM = Object.freeze({min:[2.65,.04,-.95],max:[5.58,2.95,4.02],soil:.32});
export const BOOKCASE = Object.freeze({min:[-5.55,.04,3.24],max:[-3.12,3.34,4.12],levels:[.22,1.03,1.84,2.65,3.25]});
export const HABITAT_BRANCHES = [
  {zone:'perch',radius:.16,points:[[5.22,.32,.06],[5.28,1.1,.1],[5.16,1.85,.25],[5.22,2.58,.06]]},
  {zone:'perch',radius:.075,points:[[5.28,1.1,.1],[4.62,1.27,-.2],[3.75,1.78,-.25],[3.2,2.3,.2]]},
  {zone:'perch',radius:.065,points:[[5.16,1.85,.25],[4.4,2.22,.95],[3.9,2.5,1.6]]},
  {zone:'perch',radius:.10,points:[[5.22,.32,.06],[4.75,.52,.9],[4,.4,1.55],[3.1,.34,2.0]]},
  {zone:'perch',radius:.06,points:[[4.4,2.22,.95],[4.85,2.6,1.7],[5.22,2.8,2.0]]},
];
export function boxForProp(id, zone, x, z, radius, bottom, top) {
  return { id, zone, min:[x-radius,bottom,z-radius], max:[x+radius,top,z+radius] };
}
