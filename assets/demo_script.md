# Spectrum KNX Demo Script

This script outlines the exact steps taken to produce the demo video and screenshots for the project.

## Preparation
- Load `http://localhost:5173/`
- Open Settings and change buffer limit to 80,000 telegrams
- Load 7 days of data in the Group Monitor via History loader wait a few seconds until the load dialogue is gone to be ready for the live demo 

## Recording Steps
1. **Start Recording**: Start on the main dashboard, wait for live telegrams to show up. Take `01_live_telegrams.png`.
2. **Open Filters**: Click the filter slider icon. Take `02_filter_pane_open.png`.
3. **Filter Temperature**: In the filter pane, type in search box for "temper". Add the following group addresses to the active filters: `0/1/100`, `1/2/31`, `2/2/31`, `3/2/1`. Make sure that you wait after each filter as they the click area move a bit due to the new filter. Take `03_filters.png`.
4. **Visualize Temperature**: Click on a temperature telegram row to open the visualization chart, showcasing the temperature graphs.
5. **Back to Main View**: Close the visualization to return to the Group Monitor with active filters.
6. **Add More Filters**:
   - Type in search box for "pumpe", add `1/4/4`.
   - Type in search box for "garten", add `5/5/10`.
7. **Mixed Visualization**: Click the Visualize icon (line chart) in the header. Check the mixed visualization (graphs and binary timelines) if missing. Take `04_mixed_visualization.png`.
8. **History Search**:
   - Open the app menu (top left) and switch to "History Search".
   - Set the date range from 17/04/2026 00:00 to 18/04/2026 00:00 each by clicking on the calendar icon and 17 and 18 respectively and take `05_history_search.png`.
   - Click "Search".
9. **History Visualization**: Open visualization again and check `0/1/0`, `1/4/4`, and `5/5/10`.
10. **End Recording**.
