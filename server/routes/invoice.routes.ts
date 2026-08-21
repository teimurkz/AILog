import { Router } from "express";
import { parseInvoiceDocument } from "../services/invoice.service.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { fileData, fileName, fileType } = req.body;
    const result = await parseInvoiceDocument(fileData, fileName, fileType);
    return res.json(result);
  } catch (error: any) {
    console.error("Error parsing invoice API:", error?.message || error);
    return res.json({ invoiceNumber: null, error: error?.message });
  }
});

export default router;
