FROM python:3.12-slim

ARG OPENMINUTES_VERSION
ENV PYTHONUNBUFFERED=1 HF_HOME=/models OPENMINUTES_VERSION=${OPENMINUTES_VERSION}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 whisper \
    && mkdir /models \
    && chown whisper /models

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN ffmpeg -loglevel error -f lavfi -i sine=d=1 /tmp/smoke.wav \
    && python -c "from faster_whisper.audio import decode_audio; decode_audio('/tmp/smoke.wav')" \
    && rm /tmp/smoke.wav
COPY app.py diarize.py guards.py language.py refine.py tones.py .

USER whisper
VOLUME /models
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD ["python", "-c", "import os, urllib.request; t = os.environ.get('WHISPER_TOKEN'); urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8000/health', headers={'Authorization': f'Bearer {t}'} if t else {}), timeout=4)"]
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
