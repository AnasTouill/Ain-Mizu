FROM python:3.12-slim
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY data/config.json /app/data/config.json
ENV PHYSARUM_DATA_DIR=/app/data
EXPOSE 8000
# generate the mock data on first start if the data volume is empty, then serve
CMD ["sh", "-c", "[ -f /app/data/predictions.parquet ] || python scripts/generate_mock_data.py --data-dir /app/data; uvicorn app.main:app --host 0.0.0.0 --port 8000"]
