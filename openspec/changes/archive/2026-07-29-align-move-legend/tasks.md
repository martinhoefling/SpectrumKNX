## 1. Continuous Chart Alignment (MixedChart)

- [x] 1.1 Add LEFT_GUTTER = 150 constant and configure Y-axis size to LEFT_GUTTER in MixedChart.tsx
- [x] 1.2 Set padding to [8, 16, 8, 0] in MixedChart.tsx's uPlot options
- [x] 1.3 Align the start/end range time captions in MixedChart.tsx using paddingLeft and paddingRight matching the gutters

## 2. Timeline Chart Alignment & Legend Relocation (TimelineChart)

- [x] 2.1 Remove canvas-drawn labels from the right of the plot area in TimelineChart.tsx
- [x] 2.2 Set Y-axis size to LEFT_GUTTER and padding to [10, 16, 30, 0] in TimelineChart.tsx's uPlot options
- [x] 2.3 Implement direct-DOM refs and setCursor hook value updates for active/hovered states in TimelineChart.tsx
- [x] 2.4 Add the absolute-positioned HTML legend overlay in the left gutter displaying GA names and values below them
- [x] 2.5 Align the start/end range time captions in TimelineChart.tsx using paddingLeft and paddingRight matching the gutters
