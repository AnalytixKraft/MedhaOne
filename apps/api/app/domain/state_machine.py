from app.core.exceptions import AppException
from app.models.enums import GrnStatus, PurchaseOrderStatus


class PurchaseStateMachine:
    @staticmethod
    def validate_po_transition(
        current_state: PurchaseOrderStatus,
        target_state: PurchaseOrderStatus,
    ) -> None:
        if (
            current_state == PurchaseOrderStatus.DRAFT
            and target_state == PurchaseOrderStatus.APPROVED
        ):
            return
        if current_state == PurchaseOrderStatus.APPROVED and target_state in (
            PurchaseOrderStatus.PARTIALLY_RECEIVED,
            PurchaseOrderStatus.CLOSED,
        ):
            return
        if (
            current_state == PurchaseOrderStatus.PARTIALLY_RECEIVED
            and target_state == PurchaseOrderStatus.CLOSED
        ):
            return

        raise AppException(
            error_code="INVALID_STATE",
            message=(
                f"Invalid purchase order state transition: {current_state.value} -> "
                f"{target_state.value}"
            ),
            status_code=409,
        )

    @staticmethod
    def validate_grn_transition(current_state: GrnStatus, target_state: GrnStatus) -> None:
        if current_state == GrnStatus.DRAFT and target_state == GrnStatus.POSTED:
            return
        if current_state == GrnStatus.POSTED and target_state == GrnStatus.POSTED:
            raise AppException(
                error_code="GRN_ALREADY_POSTED",
                message="GRN already posted",
                status_code=409,
            )

        raise AppException(
            error_code="INVALID_STATE",
            message=f"Invalid GRN state transition: {current_state.value} -> {target_state.value}",
            status_code=409,
        )
