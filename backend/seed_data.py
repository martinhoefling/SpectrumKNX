import asyncio
import random
from datetime import datetime, timedelta, timezone
from sqlalchemy import insert
from database import engine
from models import telegrams_table

async def seed_data():
    print("Starting data seeding...")
    
    # Sample Group Addresses and types
    gas = [
        {"ga": "1/1/1", "type": "GroupValueWrite", "dpt": "1.001", "main": 1, "sub": 1},
        {"ga": "1/1/2", "type": "GroupValueWrite", "dpt": "1.001", "main": 1, "sub": 1},
        {"ga": "1/2/1", "type": "GroupValueWrite", "dpt": "9.001", "main": 9, "sub": 1},
        {"ga": "1/2/2", "type": "GroupValueWrite", "dpt": "9.001", "main": 9, "sub": 1},
        {"ga": "1/3/1", "type": "GroupValueWrite", "dpt": "5.001", "main": 5, "sub": 1},
    ]

    telegrams = []
    now = datetime.now(timezone.utc)
    
    for i in range(100):
        ga_info = random.choice(gas)
        timestamp = now - timedelta(minutes=random.randint(0, 60), seconds=random.randint(0, 59))
        
        # Fake values based on DPT
        value_numeric = None
        value_json = None
        raw_data = b'\x00'
        
        if ga_info["dpt"] == "1.001":
            val = random.choice([0, 1])
            value_numeric = float(val)
            value_json = {"value": "On" if val == 1 else "Off"}
            raw_data = bytes([val])
        elif ga_info["dpt"] == "9.001":
            val = round(random.uniform(18.0, 25.0), 2)
            value_numeric = val
            value_json = {"value": val, "unit": "°C"}
            raw_data = b'\x0c\x1a' # Generic float data
        elif ga_info["dpt"] == "5.001":
            val = random.randint(0, 100)
            value_numeric = float(val)
            value_json = {"value": val, "unit": "%"}
            raw_data = bytes([val])

        telegrams.append({
            "timestamp": timestamp,
            "source_address": f"1.1.{random.randint(1, 10)}",
            "target_address": ga_info["ga"],
            "telegram_type": ga_info["type"],
            "dpt": ga_info["dpt"],
            "dpt_main": ga_info["main"],
            "dpt_sub": ga_info["sub"],
            "raw_data": raw_data,
            "value_numeric": value_numeric,
            "value_json": value_json
        })

    # Sort by timestamp for nicer insertion (though TimescaleDB handles it)
    telegrams.sort(key=lambda x: x["timestamp"])

    async with engine.begin() as conn:
        await conn.execute(insert(telegrams_table), telegrams)
    
    print(f"Successfully seeded {len(telegrams)} telegrams.")

if __name__ == "__main__":
    asyncio.run(seed_data())
