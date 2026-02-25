FROM python:3.11-slim
WORKDIR /app
COPY apps/api /app
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir .
EXPOSE 1730
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "1730"]
