import time
from unittest.mock import Mock

# We can mock IndividualAddress just for testing
class IndividualAddress:
    def __init__(self, addr):
        self.addr = addr
    def __str__(self):
        return str(self.addr)

import sys
sys.modules['xknx.telegram.address'] = Mock(IndividualAddress=IndividualAddress)

global_knx_project = {
    "group_addresses": {f"1/1/{i}": {"name": f"GA {i}"} for i in range(10000)},
    "devices": {f"1.1.{i%256}": {"name": f"Device {i}"} for i in range(10000)}
}

project_name_map = {"ga": {}, "ia": {}}
for addr, data in global_knx_project.get("group_addresses", {}).items():
    project_name_map["ga"][addr] = data.get("name")
for addr, data in global_knx_project.get("devices", {}).items():
    try:
        ia_str = str(IndividualAddress(addr))
    except Exception:
        ia_str = str(addr)
    project_name_map["ia"][ia_str] = data.get("name")

def run_current():
    ga_name_map = {}
    pa_name_map = {}
    if global_knx_project:
        for addr, data in global_knx_project.get("group_addresses", {}).items():
            ga_name_map[addr] = data.get("name", "")
        for addr, data in global_knx_project.get("devices", {}).items():
            try:
                ia_str = str(IndividualAddress(addr))
            except Exception:
                ia_str = str(addr)
            pa_name_map[ia_str] = data.get("name", "")
    return ga_name_map, pa_name_map

def run_optimized():
    ga_name_map = project_name_map.get("ga", {})
    pa_name_map = project_name_map.get("ia", {})
    return ga_name_map, pa_name_map

# Warmup
run_current()
run_optimized()

start = time.time()
for _ in range(100):
    run_current()
curr_time = time.time() - start

start = time.time()
for _ in range(100):
    run_optimized()
opt_time = time.time() - start

print(f"Current: {curr_time:.4f}s")
print(f"Optimized: {opt_time:.4f}s")
print(f"Speedup: {curr_time/opt_time:.2f}x")
