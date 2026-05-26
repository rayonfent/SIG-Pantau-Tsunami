from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://tsunami:tsunami123@localhost:5432/sig_tsunami"
    SECRET_KEY: str = "supersecretkey_tsunami_2024"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    ENVIRONMENT: str = "development"
    
    # Sensor simulation
    SENSOR_STREAM_INTERVAL_SEC: int = 10
    BASELINE_WINDOW_MIN: int = 45
    SMOOTHING_SAMPLES: int = 5
    
    # Siren
    SIREN_COOLDOWN_MIN: int = 5
    SIREN_NORMAL_STABLE_MIN: int = 10

    class Config:
        env_file = ".env"

settings = Settings()
