# db.py
import os
import csv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base, Station

DB_FILE = 'data.db'
DATABASE_URL = f'sqlite:///{DB_FILE}'

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)

def init_db():
    """DBファイルが存在しなければテーブルを作成する"""
    if not os.path.exists(DB_FILE):
        Base.metadata.create_all(bind=engine)

def load_gtfs_stops(stops_file='stops.txt'):
    """
    GTFS stops.txt から駅情報を読み込んでDBに保存
    停止している場合はスキップ
    """
    if not os.path.exists(stops_file):
        print(f"Warning: {stops_file} が見つかりません")
        return
    
    session = SessionLocal()
    try:
        # 既存駅をクリア
        session.query(Station).delete()
        session.commit()
        
        with open(stops_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    station = Station(
                        stop_id=row['stop_id'],
                        station_name=row['stop_name'],
                        lat=float(row['stop_lat']) if row.get('stop_lat') else None,
                        lon=float(row['stop_lon']) if row.get('stop_lon') else None,
                    )
                    session.add(station)
                except Exception as e:
                    print(f"Error loading station {row.get('stop_id')}: {e}")
                    continue
        
        session.commit()
        print(f"Loaded {session.query(Station).count()} stations from GTFS")
    except Exception as e:
        print(f"Error loading GTFS: {e}")
        session.rollback()
    finally:
        session.close()

def seed_stations():
    """後方互換性のため残す（通常は使用しない）"""
    pass