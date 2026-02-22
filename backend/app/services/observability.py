import json
import logging
import time
from collections import defaultdict
from threading import Lock


def _logger() -> logging.Logger:
    logger = logging.getLogger("gymbro")
    if logger.handlers:
        return logger

    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


LOGGER = _logger()


class RuntimeMetrics:
    def __init__(self) -> None:
        self._lock = Lock()
        self.started_at = time.time()
        self.total_requests = 0
        self.total_errors = 0
        self.total_latency_ms = 0.0
        self.requests_by_path: dict[str, int] = defaultdict(int)
        self.errors_by_path: dict[str, int] = defaultdict(int)

    def record(self, path: str, status_code: int, latency_ms: float) -> None:
        with self._lock:
            self.total_requests += 1
            self.total_latency_ms += latency_ms
            self.requests_by_path[path] += 1
            if status_code >= 400:
                self.total_errors += 1
                self.errors_by_path[path] += 1

    def snapshot(self) -> dict:
        with self._lock:
            uptime_seconds = max(time.time() - self.started_at, 1.0)
            avg_latency = (
                self.total_latency_ms / self.total_requests if self.total_requests else 0.0
            )
            return {
                "uptime_seconds": round(uptime_seconds, 2),
                "total_requests": self.total_requests,
                "total_errors": self.total_errors,
                "throughput_rps": round(self.total_requests / uptime_seconds, 4),
                "error_rate_percent": round(
                    (self.total_errors / self.total_requests * 100) if self.total_requests else 0.0,
                    2,
                ),
                "avg_latency_ms": round(avg_latency, 2),
                "requests_by_path": dict(self.requests_by_path),
                "errors_by_path": dict(self.errors_by_path),
            }


METRICS = RuntimeMetrics()


def record_request(path: str, status_code: int, latency_ms: float) -> None:
    METRICS.record(path=path, status_code=status_code, latency_ms=latency_ms)


def metrics_snapshot() -> dict:
    return METRICS.snapshot()


def log_event(event_type: str, **fields) -> None:
    payload = {"event": event_type, **fields}
    LOGGER.info(json.dumps(payload, ensure_ascii=False, default=str))
