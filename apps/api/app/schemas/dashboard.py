from pydantic import BaseModel


class DashboardMetrics(BaseModel):
    total_products: int
    total_parties: int
    total_warehouses: int
    stock_items_count: int
