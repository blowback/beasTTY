// One rounding rule for a paste throughput figure, wherever it is shown.
//
// The same number reaches the user from three places: the Paste settings modal's
// readout (what the two cadence rows add up to), the large-paste confirm's estimate,
// and the paste chip's ACHIEVED rate while a paste runs. Two of those are meant to be
// compared against each other — the whole reason the chip measures instead of quoting
// the settings back — and they cannot be compared if they round differently. Before
// this existed, 1 byte every 150 ms read "≈ 7 B/s" in the control the user picks from
// while the chip that measured the same run said "6.7 B/s".
//
// The rule: one decimal below 10, whole numbers above. Below 10 the settings this
// project chooses between are 5, 6.7 and 10 B/s, and a whole number cannot tell the
// middle one from the top. Above 10 a tenth of a byte per second is noise. A value
// that lands exactly on an integer drops the decimal ('5', not '5.0'), so the common
// case reads as the plain number it is.
//
// AD-1: no build step, native ESM, named exports only.

export function formatThroughput(rate) {
    if (!Number.isFinite(rate)) return '';
    if (rate >= 10) return String(Math.round(rate));
    return String(Math.round(rate * 10) / 10);
}
