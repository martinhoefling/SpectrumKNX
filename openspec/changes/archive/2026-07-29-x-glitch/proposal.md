## Why

To align with the application's UX conventions, the Visualization panel must have a clear panel-close action and a targets-clear action. The panel should be closed via an 'X' icon in the panel header, while the 'X' button in the Targets sidebar should function as a "clear all checkmarks" action (analogous to clearing active filters in the filter pane) rather than closing the panel.

## What Changes

- **Close Action**: Formalize the presence of the 'X' close button in the top-right header of the Visualization panel.
- **Clear Action**: Formalize the presence of the 'X' clear button in the Targets sidebar header to uncheck all selected targets when clicked.
- **Verification**: Verify that both components exist and behave as intended.

## Capabilities

### New Capabilities
- `visualization-panel-actions`: Controls the panel closing and targets clearing behaviors in the Visualization panel.

### Modified Capabilities
<!-- None -->

## Impact

- `frontend/src/components/Visualizer.tsx`: Header X close button and `onClose` behavior.
- `frontend/src/components/VisualizerSidebar.tsx`: Targets header clear button and `onTargetsChange([])` behavior.
