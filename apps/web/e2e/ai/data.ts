export type GeneratedData = {
  supplierName: string;
  warehouseName: string;
  warehouseCode: string;
  productName: string;
  productSku: string;
  batchNo: string;
  expiryDate: string;
};

export function generateData(prefix: string): GeneratedData {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  return {
    supplierName: `${prefix}-SUP-${stamp}`,
    warehouseName: `${prefix}-WH-${stamp}`,
    warehouseCode: `${prefix.slice(0, 3).toUpperCase()}${Math.floor(Math.random() * 9000 + 1000)}`,
    productName: `${prefix}-PROD-${stamp}`,
    productSku: `${prefix.slice(0, 3).toUpperCase()}-SKU-${Math.floor(Math.random() * 900000 + 100000)}`,
    batchNo: `${prefix.slice(0, 3).toUpperCase()}-BATCH-${Math.floor(Math.random() * 10000 + 1)}`,
    expiryDate: "2030-12-31",
  };
}
