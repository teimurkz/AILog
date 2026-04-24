import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO, differenceInDays } from 'date-fns';
import { Shipment } from '../types';
import { isShipmentDelayed } from './shipmentUtils';

// Helper to convert ArrayBuffer to Base64
const arrayBufferToBase64 = (buffer: ArrayBuffer): Promise<string> => {
  return new Promise((resolve) => {
    const blob = new Blob([buffer]);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
};

export const generateDelayReport = async (shipments: Shipment[], t: (key: string) => string) => {
  const doc = new jsPDF();
  const now = new Date();

  // Load a font that supports Cyrillic (Roboto)
  try {
    // Using a more reliable CDN for Roboto TTF
    const fontUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/apache/roboto/static/Roboto-Regular.ttf';
    const response = await fetch(fontUrl);
    if (!response.ok) {
      // Try fallback CDN if first one fails
      const fallbackUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf';
      const fallbackResponse = await fetch(fallbackUrl);
      if (!fallbackResponse.ok) throw new Error('Failed to fetch font from both primary and fallback CDNs');
      
      const fontBuffer = await fallbackResponse.arrayBuffer();
      const fontBase64 = await arrayBufferToBase64(fontBuffer);
      doc.addFileToVFS('Roboto-Regular.ttf', fontBase64);
    } else {
      const fontBuffer = await response.arrayBuffer();
      const fontBase64 = await arrayBufferToBase64(fontBuffer);
      doc.addFileToVFS('Roboto-Regular.ttf', fontBase64);
    }

    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'bold');
    doc.setFont('Roboto');
  } catch (error) {
    console.error('Error loading font for PDF:', error);
    // If font fails to load, we still try to generate the PDF with default fonts
    // although Cyrillic characters might not render correctly.
  }
  
  // Filter delayed shipments
  const delayedShipments = shipments.filter(s => isShipmentDelayed(s) && !s.isArchived);

  // Header
  doc.setFontSize(20);
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text('Silk Road Logistics', 14, 22);
  
  doc.setFontSize(14);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(t('reportTitle'), 14, 32);

  doc.setFontSize(10);
  doc.text(`${t('generatedOn')}: ${format(now, 'yyyy-MM-dd HH:mm')}`, 14, 40);
  doc.text(`${t('totalActive')}: ${shipments.filter(s => !s.isArchived).length}`, 14, 46);
  doc.text(`${t('delayedShipments')}: ${delayedShipments.length}`, 14, 52);

  if (delayedShipments.length > 0) {
    const tableData = delayedShipments.map(s => {
      const deadline = s.arrival_deadline ? parseISO(s.arrival_deadline) : now;
      const departure = s.departure_date ? parseISO(s.departure_date) : now;
      const delayDays = differenceInDays(now, deadline);
      
      let delayText = t('onTime');
      if (delayDays > 0) delayText = `${delayDays} ${t('days')}`;
      else if (delayDays === 0) delayText = t('dueToday');

      return [
        s.invoice_id || 'N/A',
        s.route || 'N/A',
        format(departure, 'yyyy-MM-dd'),
        format(deadline, 'yyyy-MM-dd'),
        t(s.status as any) || s.status,
        delayText
      ];
    });

    autoTable(doc, {
      startY: 60,
      head: [[t('invoiceNum'), t('route'), t('departureDate'), t('deadline'), t('status'), t('delayDays')]],
      body: tableData,
      headStyles: { fillColor: [220, 38, 38], textColor: [255, 255, 255], font: 'Roboto', fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [254, 242, 242] },
      margin: { top: 60 },
      styles: { fontSize: 9, cellPadding: 3, font: 'Roboto' }
    });
  } else {
    doc.setFontSize(12);
    doc.setTextColor(16, 185, 129); // emerald-500
    doc.text(t('noDelaysFound'), 14, 70);
    
    const activeShipments = shipments.filter(s => !s.isArchived && s.status !== 'Delivered');
    if (activeShipments.length > 0) {
      doc.setTextColor(100, 116, 139);
      doc.text(t('activeSummary'), 14, 80);
      
      const tableData = activeShipments.map(s => {
        const deadline = s.arrival_deadline ? parseISO(s.arrival_deadline) : now;
        const departure = s.departure_date ? parseISO(s.departure_date) : now;
        return [
          s.invoice_id || 'N/A',
          s.route || 'N/A',
          format(departure, 'yyyy-MM-dd'),
          format(deadline, 'yyyy-MM-dd'),
          t(s.status as any) || s.status
        ];
      });

      autoTable(doc, {
        startY: 85,
        head: [[t('invoiceNum'), t('route'), t('departureDate'), t('deadline'), t('status')]],
        body: tableData,
        headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], font: 'Roboto', fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        styles: { fontSize: 9, font: 'Roboto' }
      });
    }
  }

  doc.save(`shipment-report-${format(now, 'yyyyMMdd-HHmm')}.pdf`);
};
