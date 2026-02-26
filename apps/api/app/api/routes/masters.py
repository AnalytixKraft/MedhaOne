from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.party import Party
from app.models.product import Product
from app.models.warehouse import Warehouse
from app.schemas.masters import (
    PartyCreate,
    PartyRead,
    PartyUpdate,
    ProductCreate,
    ProductRead,
    ProductUpdate,
    WarehouseCreate,
    WarehouseRead,
    WarehouseUpdate,
)

router = APIRouter()


def _commit_or_400(db: Session, error_message: str) -> None:
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=error_message
        ) from error


def _get_or_404(db: Session, model, item_id: int, label: str):
    record = db.get(model, item_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return record


@router.get("/parties", response_model=list[PartyRead])
def list_parties(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> list[PartyRead]:
    query = db.query(Party).order_by(Party.name.asc())
    if not include_inactive:
        query = query.filter(Party.is_active.is_(True))
    return query.all()


@router.post("/parties", response_model=PartyRead, status_code=status.HTTP_201_CREATED)
def create_party(
    payload: PartyCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> PartyRead:
    party = Party(**payload.model_dump())
    db.add(party)
    _commit_or_400(db, "Failed to create party")
    db.refresh(party)
    return party


@router.get("/parties/{party_id}", response_model=PartyRead)
def get_party(
    party_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> PartyRead:
    return _get_or_404(db, Party, party_id, "Party")


@router.put("/parties/{party_id}", response_model=PartyRead)
def update_party(
    party_id: int,
    payload: PartyUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> PartyRead:
    party = _get_or_404(db, Party, party_id, "Party")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(party, field, value)

    _commit_or_400(db, "Failed to update party")
    db.refresh(party)
    return party


@router.delete("/parties/{party_id}", response_model=PartyRead)
def delete_party(
    party_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> PartyRead:
    party = _get_or_404(db, Party, party_id, "Party")
    party.is_active = False
    _commit_or_400(db, "Failed to deactivate party")
    db.refresh(party)
    return party


@router.get("/products", response_model=list[ProductRead])
def list_products(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> list[ProductRead]:
    query = db.query(Product).order_by(Product.name.asc())
    if not include_inactive:
        query = query.filter(Product.is_active.is_(True))
    return query.all()


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ProductRead:
    product = Product(**payload.model_dump())
    db.add(product)
    _commit_or_400(db, "Failed to create product. SKU must be unique")
    db.refresh(product)
    return product


@router.get("/products/{product_id}", response_model=ProductRead)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ProductRead:
    return _get_or_404(db, Product, product_id, "Product")


@router.put("/products/{product_id}", response_model=ProductRead)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ProductRead:
    product = _get_or_404(db, Product, product_id, "Product")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, field, value)

    _commit_or_400(db, "Failed to update product")
    db.refresh(product)
    return product


@router.delete("/products/{product_id}", response_model=ProductRead)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ProductRead:
    product = _get_or_404(db, Product, product_id, "Product")
    product.is_active = False
    _commit_or_400(db, "Failed to deactivate product")
    db.refresh(product)
    return product


@router.get("/warehouses", response_model=list[WarehouseRead])
def list_warehouses(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> list[WarehouseRead]:
    query = db.query(Warehouse).order_by(Warehouse.name.asc())
    if not include_inactive:
        query = query.filter(Warehouse.is_active.is_(True))
    return query.all()


@router.post("/warehouses", response_model=WarehouseRead, status_code=status.HTTP_201_CREATED)
def create_warehouse(
    payload: WarehouseCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> WarehouseRead:
    warehouse = Warehouse(**payload.model_dump())
    db.add(warehouse)
    _commit_or_400(db, "Failed to create warehouse. Code must be unique")
    db.refresh(warehouse)
    return warehouse


@router.get("/warehouses/{warehouse_id}", response_model=WarehouseRead)
def get_warehouse(
    warehouse_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> WarehouseRead:
    return _get_or_404(db, Warehouse, warehouse_id, "Warehouse")


@router.put("/warehouses/{warehouse_id}", response_model=WarehouseRead)
def update_warehouse(
    warehouse_id: int,
    payload: WarehouseUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> WarehouseRead:
    warehouse = _get_or_404(db, Warehouse, warehouse_id, "Warehouse")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(warehouse, field, value)

    _commit_or_400(db, "Failed to update warehouse")
    db.refresh(warehouse)
    return warehouse


@router.delete("/warehouses/{warehouse_id}", response_model=WarehouseRead)
def delete_warehouse(
    warehouse_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> WarehouseRead:
    warehouse = _get_or_404(db, Warehouse, warehouse_id, "Warehouse")
    warehouse.is_active = False
    _commit_or_400(db, "Failed to deactivate warehouse")
    db.refresh(warehouse)
    return warehouse
