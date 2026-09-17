export type FixtureScale = "small" | "medium" | "large";

const SCALE_SIZE: Record<FixtureScale, number> = {
  small: 1,
  medium: 10,
  large: 100
};

export function createScaleFixture(scale: FixtureScale): readonly string[] {
  return Array.from(
    { length: SCALE_SIZE[scale] },
    (_, index) => `${scale}-${index + 1}`
  );
}
