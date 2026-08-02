## Context

See proposal.md - Why. Currently, `MixedChart` (for continuous metrics) and `TimelineChart` (for binary state timelines) do not align because of differing margin, padding, and legend placement. Additionally, metric values are clipped on the left of `MixedChart` due to insufficient width (size) allocated for the Y-axis.

## Goals / Non-Goals

**Goals:**
- Fix y-axis scale clipping in `MixedChart` by allocating adequate space.
- Move the GA legend in `TimelineChart` from the right to the left gutter.
- Vertically align the left and right plot grid boundaries of both `MixedChart` and `TimelineChart`.
- Display the GA name and its active/hovered value (below the name) in the left gutter of `TimelineChart`.
- Align the start/end range time captions under the plot area boundaries for both charts.
- Keep hover updates highly performant.

**Non-Goals:**
- Modifying the styling or logic of other charts/tables outside `MixedChart` and `TimelineChart`.
- Adding interactive toggle features (like showing/hiding series) to the `TimelineChart` legend since it represents single-state rows.

## Decisions

### 1. Unified Left Gutter and Margins
We will introduce a shared layout constant `LEFT_GUTTER = 150` pixels.
- **For both charts**: Set uPlot padding to `[8, 16, 8, 0]` (or `[10, 16, 30, 0]` for `TimelineChart` to fit the X-axis).
- **For both charts**: Set the Y-axis size to `LEFT_GUTTER` (150).
- **Rationale**: By enforcing identical left offset (`LEFT_GUTTER`) and right padding (`16`), the plotting canvas areas will align pixel-for-pixel horizontally.
- **Alternatives considered**: Using CSS grid layouts with multiple columns. This was rejected because uPlot handles its own internal layout on the canvas, meaning the canvas-drawn Y-axis in `MixedChart` would still offset the grid area.

### 2. Relocate GA Legend in TimelineChart to HTML Overlay
We will remove the canvas-drawn GA name labels from the right of the `TimelineChart` plot area. Instead, we will render the legends using HTML elements absolute-positioned over the left Y-axis gutter.
- **Positioning**: The HTML legend container will be overlayed at `left: 8px` (to account for padding) and `top: 14px` (matching the top of the plot area plus rowGap), with a width of `134px` (`LEFT_GUTTER - 16px`).
- **Rows**: Each row will have a fixed height of `rowHeight = 40px` and `marginBottom = 4px` to match the custom canvas bars drawn by `timelinePlugin`.
- **Alternatives considered**: Drawing the text and active value in the canvas inside the plugin's `draw` hook. This was rejected because updating canvas text dynamically on mouse move requires full chart redraws, which is computationally expensive and causes visual lag.

### 3. Direct DOM Optimization for Dynamic Value Display
To display the active/hovered GA value (e.g., "On", "Off", or "-") dynamically:
- We will store refs to the value elements in a `useRef` array: `valueRefs = useRef<(HTMLSpanElement | null)[]>([]);`
- In the uPlot `setCursor` hook, we will retrieve the hovered index (`u.cursor.idx`) or determine if the cursor is outside the chart.
- We will update the `textContent` and style color of the refs directly, bypassing React's render/diffing cycle.
- **Rationale**: Direct DOM updates guarantee 60fps performance on mouse movement without triggering React component re-renders.

### 4. Align Start/End Time Captions
For both `MixedChart` and `TimelineChart`, we will style the start/end time captions container under the chart with:
`paddingLeft: '150px', paddingRight: '16px'`
- **Rationale**: This ensures the start/end times sit exactly below the left and right boundaries of the chart grid area.

## Risks / Trade-offs

- **[Risk] Long GA Names Overflowing**: A GA name longer than 15-20 characters might overflow the 134px legend width.
  - **Mitigation**: We will style the name with `overflow: 'hidden'`, `textOverflow: 'ellipsis'`, `whiteSpace: 'nowrap'`, and add a native HTML `title={s.name}` attribute so the full name is visible on hover.
