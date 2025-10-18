# main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional, List
from sqlalchemy.orm import Session
import math
import uvicorn
import secrets

from db import SessionLocal, init_db, load_gtfs_stops
from models import Station, Observation, Melody

app = FastAPI(title="Melody Observer API")

app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ObsIn(BaseModel):
    station_id: int
    platform: int
    choruses: float
    reported_at: Optional[datetime] = None
    destination: Optional[str] = None
    note: Optional[str] = None

class StationOut(BaseModel):
    id: int
    stop_id: str
    station_name: str

class MelodyIn(BaseModel):
    station_id: int
    platform: int
    melody_name: str

class MelodyOut(BaseModel):
    id: int
    station_id: int
    platform: int
    melody_name: str

def wilson_interval(k: int, n: int, z: float = 1.96):
    if n == 0:
        return (0.0, 0.0)
    phat = k / n
    z2 = z * z
    denom = 1 + z2 / n
    center = (phat + z2 / (2*n)) / denom
    margin = z * math.sqrt((phat*(1-phat)/n) + z2/(4*n*n)) / denom
    low = max(0.0, center - margin)
    high = min(1.0, center + margin)
    return (low, high)

def detect_anomaly(choruses: float, destination: str, platform: int, station_id: int) -> tuple[bool, str]:
    """虚偽検出: 異常なパターンを検出"""
    db: Session = SessionLocal()
    try:
        recent = db.query(Observation).filter(
            Observation.station_id == station_id,
            Observation.platform == platform,
            Observation.destination == destination,
            Observation.created_at > datetime.utcnow() - timedelta(minutes=1)
        ).count()
        if recent > 0:
            return True, "1分以内に同じ内容の投稿がされています"
        
        if choruses > 500:
            return True, "不自然なコーラス数です"
        
        recent_count = db.query(Observation).filter(
            Observation.created_at > datetime.utcnow() - timedelta(minutes=5)
        ).count()
        if recent_count > 20:
            return True, "短時間に大量投稿が検出されました"
        
        return False, ""
    finally:
        db.close()

def generate_session_token() -> str:
    return secrets.token_urlsafe(16)

@app.on_event("startup")
def startup():
    init_db()
    load_gtfs_stops()

@app.get("/api/stations", response_model=List[StationOut])
def get_stations():
    db: Session = SessionLocal()
    try:
        stations = db.query(Station).order_by(Station.station_name).all()
        return [StationOut(id=s.id, stop_id=s.stop_id, station_name=s.station_name) for s in stations]
    finally:
        db.close()

@app.post("/api/observations")
def post_obs(obs: ObsIn):
    db: Session = SessionLocal()
    try:
        station = db.query(Station).filter(Station.id == obs.station_id).first()
        if not station:
            raise HTTPException(status_code=400, detail="Station not found")
        
        is_anomaly, msg = detect_anomaly(obs.choruses, obs.destination, obs.platform, obs.station_id)
        if is_anomaly:
            raise HTTPException(status_code=400, detail=msg)
        
        token = generate_session_token()
        o = Observation(
            station_id=obs.station_id,
            platform=obs.platform,
            choruses=float(obs.choruses),
            reported_at=obs.reported_at,
            destination=obs.destination,
            note=obs.note,
            token=token
        )
        db.add(o)
        db.commit()
        db.refresh(o)
        return {"ok": True, "id": o.id, "token": token}
    finally:
        db.close()

@app.delete("/api/observations/{obs_id}")
def delete_obs(obs_id: int, token: str):
    db: Session = SessionLocal()
    try:
        obs = db.query(Observation).filter(Observation.id == obs_id).first()
        if not obs:
            raise HTTPException(status_code=404, detail="Observation not found")
        
        if obs.token != token:
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        db.delete(obs)
        db.commit()
        return {"ok": True}
    finally:
        db.close()

@app.post("/api/melodies")
def post_melody(melody: MelodyIn):
    """メロディー情報を登録・更新"""
    db: Session = SessionLocal()
    try:
        station = db.query(Station).filter(Station.id == melody.station_id).first()
        if not station:
            raise HTTPException(status_code=400, detail="Station not found")
        
        # 既存のメロディーを確認
        existing = db.query(Melody).filter(
            Melody.station_id == melody.station_id,
            Melody.platform == melody.platform
        ).first()
        
        if existing:
            existing.melody_name = melody.melody_name
        else:
            m = Melody(
                station_id=melody.station_id,
                platform=melody.platform,
                melody_name=melody.melody_name
            )
            db.add(m)
        
        db.commit()
        return {"ok": True}
    finally:
        db.close()

@app.get("/api/melodies/station/{station_id}", response_model=List[MelodyOut])
def get_station_melodies(station_id: int):
    """駅のメロディー一覧を取得"""
    db: Session = SessionLocal()
    try:
        melodies = db.query(Melody).filter(Melody.station_id == station_id).all()
        return [MelodyOut(id=m.id, station_id=m.station_id, platform=m.platform, melody_name=m.melody_name) for m in melodies]
    finally:
        db.close()

@app.get("/api/stats/station/{station_id}")
def station_stats(station_id: int, min_choruses: float = 1.0):
    """駅の統計を取得"""
    db: Session = SessionLocal()
    try:
        station = db.query(Station).filter(Station.id == station_id).first()
        if not station:
            raise HTTPException(status_code=404, detail="Station not found")

        total = db.query(Observation).filter(Observation.station_id == station_id).count()
        k = db.query(Observation).filter(
            Observation.station_id == station_id,
            Observation.choruses >= min_choruses
        ).count()
        p_hat = (k / total) if total > 0 else 0.0
        low, high = wilson_interval(k, total)

        # メロディー情報を取得
        melodies_dict = {}
        melodies = db.query(Melody).filter(Melody.station_id == station_id).all()
        for m in melodies:
            melodies_dict[m.platform] = m.melody_name

        platform_data = {}
        rows = db.query(Observation).filter(
            Observation.station_id == station_id
        ).all()
        
        for r in rows:
            plat = r.platform
            if plat not in platform_data:
                platform_data[plat] = {"n": 0, "k": 0, "observations": []}
            platform_data[plat]["n"] += 1
            if r.choruses >= min_choruses:
                platform_data[plat]["k"] += 1
            platform_data[plat]["observations"].append(r)

        platform_list = []
        for plat in sorted(platform_data.keys()):
            v = platform_data[plat]
            n = v["n"]
            kk = v["k"]
            ph = kk / n if n > 0 else 0
            lowp, highp = wilson_interval(kk, n)
            
            hourly = {}
            for r in v["observations"]:
                if r.reported_at:
                    h = r.reported_at.replace(minute=0, second=0, microsecond=0)
                    key = h.isoformat()
                    if key not in hourly:
                        hourly[key] = {"n": 0, "k": 0}
                    hourly[key]["n"] += 1
                    if r.choruses >= min_choruses:
                        hourly[key]["k"] += 1
            
            hourly_list = []
            for ktime, hv in sorted(hourly.items()):
                hn = hv["n"]
                hk = hv["k"]
                hph = hk / hn if hn > 0 else 0
                lowh, highh = wilson_interval(hk, hn)
                hourly_list.append({"hour": ktime, "n": hn, "k": hk, "p_hat": hph, "ci_low": lowh, "ci_high": highh})
            
            latest = []
            for r in sorted(v["observations"], key=lambda x: x.created_at, reverse=True)[:5]:
                latest.append({
                    "id": r.id,
                    "reported_at": r.reported_at.isoformat() if r.reported_at else None,
                    "destination": r.destination,
                    "choruses": r.choruses,
                    "note": r.note,
                    "created_at": r.created_at.isoformat(),
                    "token": r.token
                })
            
            platform_list.append({
                "platform": plat,
                "melody_name": melodies_dict.get(plat, "未設定"),
                "n": n,
                "k": kk,
                "p_hat": ph,
                "ci_low": lowp,
                "ci_high": highp,
                "hourly": hourly_list,
                "latest": latest
            })

        return {
            "station_id": station_id,
            "station_name": station.station_name,
            "total": total,
            "k": k,
            "p_hat": p_hat,
            "ci_low": low,
            "ci_high": high,
            "platforms": platform_list
        }
    finally:
        db.close()

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)