/**
 * The spread `CantidadHoras.dc.html` draws: the target, up to four 15-minute steps below it
 * (those above 0) and three 30-minute steps above, ascending — 90 reads 30, 45, 60, 75, 90, 120, 150, 180.
 */
export function timeChipsAround(target: number): number[] {
  const chips = [target];
  for (let step = 1; step <= 4; step++) {
    const value = target - 15 * step;
    if (value > 0) chips.unshift(value);
  }
  for (let step = 1; step <= 3; step++) chips.push(target + 30 * step);
  return chips;
}
