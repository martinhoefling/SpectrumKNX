## Why

The y-axis scale on continuous metric charts (such as illuminance/lx) is clipped at the left margin, making it unreadable. Additionally, the binary states timeline chart currently places its Group Address (GA) legend on the right side, while continuous charts place their scale on the left. This mismatch prevents the left and right plot borders of the charts from aligning, which reduces readability when they are displayed together.

## What Changes

- **Fix Y-Axis Clipping**: Adjust the Y-axis size of `MixedChart` to ensure there is enough horizontal space to render large values (like illuminance/lx or temperature) without clipping.
- **Relocate GA Legend**: Move the GA legend in the `TimelineChart` from the right side of the chart to the left side.
- **Align Graph Borders**: Establish a consistent left gutter width and right padding for both `MixedChart` and `TimelineChart` so that the actual plotting areas of all charts align perfectly on their left and right edges.
- **Legend Layout**: Draw the GA name and its active value (below the name) inside the left gutter of the `TimelineChart`.

## Capabilities

### New Capabilities
- `visualization-layout`: Handles the layout alignment, margins, padding, and legend positioning of both metric and timeline visualization charts.

### Modified Capabilities
<!-- None -->

## Impact

- `frontend/src/components/MixedChart.tsx`: Update uPlot configuration for the Y-axis size/padding to prevent label clipping and align left borders.
- `frontend/src/components/TimelineChart.tsx`: Modify padding settings, adjust the uPlot layout, and update the custom canvas drawing plugin to render the GA legend (with values below the names) on the left side of the chart.
