# models.py
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Float
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime

Base = declarative_base()

class Station(Base):
    __tablename__ = 'stations'
    id = Column(Integer, primary_key=True)
    stop_id = Column(String, unique=True, nullable=False)  # GTFS stop_id
    station_name = Column(String, nullable=False)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)

class Melody(Base):
    """駅・番線ごとの発車メロディー情報"""
    __tablename__ = 'melodies'
    id = Column(Integer, primary_key=True, autoincrement=True)
    station_id = Column(Integer, ForeignKey('stations.id'), nullable=False)
    platform = Column(Integer, nullable=False)
    melody_name = Column(String, nullable=False)  # 例: "ジングルベル", "越後湯沢駅"
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    station = relationship('Station')

class Observation(Base):
    __tablename__ = 'observations'
    id = Column(Integer, primary_key=True, autoincrement=True)
    station_id = Column(Integer, ForeignKey('stations.id'), nullable=False)
    platform = Column(Integer, nullable=False)
    choruses = Column(Float, nullable=False)
    reported_at = Column(DateTime, nullable=True)
    destination = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    token = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    station = relationship('Station')

class UserSession(Base):
    __tablename__ = 'user_sessions'
    id = Column(Integer, primary_key=True, autoincrement=True)
    token = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)# models.py
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Float
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime

Base = declarative_base()

class Station(Base):
    __tablename__ = 'stations'
    id = Column(Integer, primary_key=True)
    stop_id = Column(String, unique=True, nullable=False)  # GTFS stop_id
    station_name = Column(String, nullable=False)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)

class Melody(Base):
    """駅・番線ごとの発車メロディー情報"""
    __tablename__ = 'melodies'
    id = Column(Integer, primary_key=True, autoincrement=True)
    station_id = Column(Integer, ForeignKey('stations.id'), nullable=False)
    platform = Column(Integer, nullable=False)
    melody_name = Column(String, nullable=False)  # 例: "ジングルベル", "越後湯沢駅"
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    station = relationship('Station')

class Observation(Base):
    __tablename__ = 'observations'
    id = Column(Integer, primary_key=True, autoincrement=True)
    station_id = Column(Integer, ForeignKey('stations.id'), nullable=False)
    platform = Column(Integer, nullable=False)
    choruses = Column(Float, nullable=False)
    reported_at = Column(DateTime, nullable=True)
    destination = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    token = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    station = relationship('Station')

class UserSession(Base):
    __tablename__ = 'user_sessions'
    id = Column(Integer, primary_key=True, autoincrement=True)
    token = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)