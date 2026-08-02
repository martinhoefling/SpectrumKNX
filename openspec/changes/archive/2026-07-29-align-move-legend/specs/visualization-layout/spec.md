## Purpose

Defines the layout rules, border alignment, and legend positioning for metric and timeline visualization charts to ensure clear readability and consistent horizontal alignment.

## ADDED Requirements

### Requirement: Align Chart Borders
The system SHALL align the left and right borders of the active plot areas in both the metric MixedChart and the binary states TimelineChart so they line up vertically on screen.

#### Scenario: Aligned charts
- **WHEN** the user views the visualization panel with both binary and continuous targets selected
- **THEN** the left boundary of both chart plotting grids SHALL align horizontally, and the right boundary of both chart plotting grids SHALL align horizontally

### Requirement: Left-aligned GA Legend for Timeline Chart
The system SHALL display the Group Address (GA) legend in the left gutter of the TimelineChart instead of the right side.

#### Scenario: Legend on the left
- **WHEN** the user views a binary states timeline chart
- **THEN** the name of each GA SHALL be rendered inside the left gutter (before the start of the bar)

### Requirement: Legend GA Value Placement
The system SHALL render the active value of each GA (e.g., "On", "Off", or "-") below the GA's name in the left gutter of the TimelineChart.

#### Scenario: Active value below name
- **WHEN** the user hovers over a time point on the timeline chart
- **THEN** the active value for each GA at that timestamp SHALL be displayed directly below the GA name in the left gutter

### Requirement: Prevent Y-Axis Label Clipping
The system SHALL reserve sufficient spacing in the left gutter of MixedChart to ensure that y-axis tick labels are not cut off at the left margin.

#### Scenario: Long y-axis values
- **WHEN** a continuous chart displays large values such as illuminance in lx (e.g., "1200 lx" or "500 lx")
- **THEN** the y-axis tick labels SHALL be fully visible and not clipped at the left edge of the chart container
