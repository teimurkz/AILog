import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChevronRight, 
  Trash2, 
  CheckCircle2, 
  MapPin, 
  Navigation, 
  Truck, 
  FileText, 
  Clock, 
  Upload, 
  Calendar, 
  X,
  AlertCircle,
  Package
} from 'lucide-react';
import { format, parseISO, differenceInDays, addDays } from 'date-fns';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  deleteDoc 
} from 'firebase/firestore';
import { ref, getDownloadURL, uploadBytesResumable, deleteObject } from 'firebase/storage';
import { db, auth, storage, handleFirestoreError, OperationType } from '../../firebase';
import { useLanguage } from '../../contexts/LanguageContext';
import { Shipment, ShipmentLog, ShipmentStatus } from '../../types';
import { cn } from '../../lib/utils';
import { isShipmentDelayed } from '../../utils/shipmentUtils';
import { useAuth } from '../../contexts/AuthContext';

interface ShipmentDetailsProps {
  shipment: Shipment;
  onBack: () => void;
}

export const ShipmentDetails = ({ shipment, onBack }: ShipmentDetailsProps) => {
  const { t, isRTL } = useLanguage();
  const { isAdmin, isLogistics } = useAuth();
  const [logs, setLogs] = useState<ShipmentLog[]>([]);
  const [newLog, setNewLog] = useState('');
  const [statusMessage, setStatusMessage] = useState(shipment.status_message || '');
  const [newStatus, setNewStatus] = useState<ShipmentStatus>(shipment.status);
  const [newDepartureDate, setNewDepartureDate] = useState(format(parseISO(shipment.departure_date), 'yyyy-MM-dd'));
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [isEditingDate, setIsEditingDate] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, `shipments/${shipment.id}/logs`),
      orderBy('timestamp', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ShipmentLog)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `shipments/${shipment.id}/logs`);
    });
  }, [shipment.id]);

  const handleUpdate = async () => {
    if (!isLogistics) return;
    const logPath = `shipments/${shipment.id}/logs`;
    const now = new Date().toISOString();
    
    try {
      // Check if status changed
      if (newStatus !== shipment.status) {
        const statusLog = {
          shipmentId: shipment.id,
          timestamp: now,
          location: shipment.route,
          message: t('statusUpdated').replace('{status}', t(newStatus as any)),
          updatedBy: auth.currentUser?.displayName || 'System'
        };
        await addDoc(collection(db, logPath), statusLog);
      }

      // Check if date changed
      if (newDepartureDate !== format(parseISO(shipment.departure_date), 'yyyy-MM-dd')) {
        const oldDate = format(parseISO(shipment.departure_date), 'yyyy-MM-dd');
        const departure = parseISO(newDepartureDate);
        const arrivalDeadline = addDays(departure, shipment.est_travel_time).toISOString();

        const dateLog = {
          shipmentId: shipment.id,
          timestamp: now,
          location: shipment.route,
          message: t('departureDateUpdated').replace('{old}', oldDate).replace('{new}', newDepartureDate),
          updatedBy: auth.currentUser?.displayName || 'System'
        };
        await addDoc(collection(db, logPath), dateLog);
        
        await updateDoc(doc(db, 'shipments', shipment.id), {
          departure_date: departure.toISOString(),
          arrival_deadline: arrivalDeadline
        });
      }

      if (newLog) {
        const logData = {
          shipmentId: shipment.id,
          timestamp: now,
          location: shipment.route,
          message: newLog,
          updatedBy: auth.currentUser?.displayName || 'System'
        };
        await addDoc(collection(db, logPath), logData);
        setNewLog('');
      }

      await updateDoc(doc(db, 'shipments', shipment.id), {
        status: newStatus,
        status_message: statusMessage,
        last_updated: now
      });

      setIsEditingDate(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, logPath);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isLogistics) return;
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadProgress(0);
    
    try {
      const storageRef = ref(storage, `Invoices/${shipment.invoice_id}/${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        }, 
        (error) => {
          console.error('Upload error:', error);
          setUploading(false);
        }, 
        async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          
          // Use a Set to ensure we don't have duplicate URLs if the same file is re-uploaded
          const currentUrls = shipment.documents_url || [];
          const updatedUrls = Array.from(new Set([...currentUrls, url]));
          
          await updateDoc(doc(db, 'shipments', shipment.id), {
            documents_url: updatedUrls,
            last_updated: new Date().toISOString()
          });
          setUploading(false);
          setUploadProgress(0);
        }
      );
    } catch (err) {
      console.error('Upload error:', err);
      setUploading(false);
    }
  };

  const handleFileDelete = async () => {
    if (!isLogistics) return;
    if (!fileToDelete) return;

    try {
      // Try to delete from storage first
      try {
        const fileRef = ref(storage, fileToDelete);
        await deleteObject(fileRef);
      } catch (storageErr) {
        console.warn('File not found in storage, proceeding to remove from Firestore', storageErr);
      }

      const updatedUrls = (shipment.documents_url || []).filter(u => u !== fileToDelete);
      await updateDoc(doc(db, 'shipments', shipment.id), {
        documents_url: updatedUrls,
        last_updated: new Date().toISOString()
      });
      setFileToDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `shipments/${shipment.id}`);
    }
  };

  const markAsDelivered = async () => {
    if (!isLogistics) return;
    try {
      await updateDoc(doc(db, 'shipments', shipment.id), {
        status: 'Delivered',
        last_updated: new Date().toISOString(),
        actual_arrival_date: new Date().toISOString()
      });
      onBack();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `shipments/${shipment.id}`);
    }
  };

  const handleDelete = async () => {
    if (!isAdmin) return;
    try {
      await deleteDoc(doc(db, 'shipments', shipment.id));
      onBack();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `shipments/${shipment.id}`);
    }
  };

  const daysPassed = differenceInDays(new Date(), parseISO(shipment.departure_date));
  const progress = Math.min(Math.max((daysPassed / shipment.est_travel_time) * 100, 0), 100);
  const isDelayed = isShipmentDelayed(shipment);

  return (
    <div className="space-y-6">
      <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-4", isRTL && "sm:flex-row-reverse")}>
        <div className={cn("flex items-center gap-2 sm:gap-4", isRTL && "flex-row-reverse")}>
          <button onClick={onBack} className="p-2 hover:bg-white rounded-xl transition-colors shrink-0">
            <ChevronRight className={cn("w-5 h-5 sm:w-6 sm:h-6 text-slate-600", isRTL ? "" : "rotate-180")} />
          </button>
          <div className={isRTL ? "text-right" : "text-left"}>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 truncate max-w-[200px] sm:max-w-none">{shipment.invoice_id}</h2>
            <p className="text-xs sm:text-sm text-slate-500 truncate">{shipment.route}</p>
          </div>
        </div>
        <div className={cn("flex items-center gap-2 sm:gap-4 w-full sm:w-auto", isRTL && "flex-row-reverse")}>
          {isAdmin && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2 sm:p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
              title={t('delete')}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
          {shipment.status !== 'Delivered' && isLogistics && (
            <button
              onClick={markAsDelivered}
              className="flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-2.5 bg-emerald-600 text-white font-bold text-sm sm:text-base rounded-xl hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-900/10 flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
              {t('delivered')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-4 sm:p-8 rounded-2xl shadow-sm border border-slate-100">
            <div className={cn("flex flex-col sm:flex-row items-center justify-between mb-8 gap-6 sm:gap-0", isRTL && "sm:flex-row-reverse")}>
              <div className="text-center">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-2">
                  <MapPin className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
                </div>
                <p className="text-sm font-bold text-slate-900">{shipment.route.split(' - ')[0]}</p>
                <p className="text-[10px] sm:text-xs text-slate-500">{t('departureDate')}: {format(parseISO(shipment.departure_date), 'MMM d')}</p>
              </div>
              <div className="flex-1 w-full sm:w-auto px-4 sm:px-8 relative py-4 sm:py-0">
                <div className="h-0.5 w-full bg-slate-100 absolute top-10 sm:top-6 left-0" />
                <div 
                  className={cn("h-0.5 absolute top-10 sm:top-6 left-0 transition-all duration-1000", isDelayed ? 'bg-red-500' : 'bg-blue-600')}
                  style={{ width: `${progress}%` }}
                />
                <div className="absolute top-4 sm:top-0 left-1/2 -translate-x-1/2 flex flex-col items-center">
                  <Truck className={cn("w-10 h-10 sm:w-12 sm:h-12 bg-white p-2 rounded-full shadow-sm border border-slate-100 mb-2", isDelayed ? 'text-red-600' : 'text-blue-600')} />
                  <p className={cn("text-[10px] font-bold uppercase tracking-widest whitespace-nowrap", isDelayed && shipment.status !== 'Delivered' ? 'text-red-600' : 'text-blue-600')}>
                    {t(shipment.status as any)}
                    {isDelayed && shipment.status !== 'Delivered' && ` (${t('delayed')})`}
                  </p>
                </div>
              </div>
              <div className="text-center">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-2">
                  <Navigation className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400" />
                </div>
                <p className="text-sm font-bold text-slate-900">{shipment.route.split(' - ')[1]}</p>
                <p className="text-[10px] sm:text-xs text-slate-500">Deadline: {format(parseISO(shipment.arrival_deadline), 'MMM d')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="p-3 sm:p-4 bg-slate-50 rounded-xl">
                <div className={cn("flex items-center gap-2 text-slate-500 mb-1", isRTL && "flex-row-reverse")}>
                  <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="text-xs font-medium">{t('truckId')}</span>
                </div>
                <p className={cn("text-sm font-bold text-slate-900", isRTL && "text-right")}>{shipment.invoice_id}</p>
              </div>
              <div className="p-3 sm:p-4 bg-slate-50 rounded-xl relative group">
                <div className={cn("flex items-center justify-between mb-1", isRTL && "flex-row-reverse")}>
                  <div className={cn("flex items-center gap-2 text-slate-500", isRTL && "flex-row-reverse")}>
                    <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <span className="text-xs font-medium">{t('departureDate')}</span>
                  </div>
                  {isLogistics && (
                    <button 
                      onClick={() => setIsEditingDate(!isEditingDate)}
                      className="text-[10px] font-bold text-blue-600 hover:text-blue-700 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                    >
                      {t('editDate')}
                    </button>
                  )}
                </div>
                {isEditingDate ? (
                  <input 
                    type="date"
                    value={newDepartureDate}
                    onChange={(e) => setNewDepartureDate(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                ) : (
                  <p className={cn("text-sm font-bold text-slate-900", isRTL && "text-right")}>
                    {format(parseISO(shipment.departure_date), 'yyyy-MM-dd')}
                  </p>
                )}
              </div>
              <div className="p-3 sm:p-4 bg-slate-50 rounded-xl">
                <div className={cn("flex items-center gap-2 text-slate-500 mb-1", isRTL && "flex-row-reverse")}>
                  <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="text-xs font-medium">{t('timeElapsed')}</span>
                </div>
                <p className={cn("text-sm font-bold text-slate-900", isRTL && "text-right")}>
                  {daysPassed} {t('daysPassed')}
                </p>
              </div>
            </div>

            {(shipment.customs_date || shipment.actual_arrival_date) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mt-6 pt-6 border-t border-slate-100">
                {shipment.customs_date && (
                  <div className="p-3 sm:p-4 bg-indigo-50/50 rounded-xl border border-indigo-100">
                    <div className={cn("flex items-center gap-2 text-indigo-600 mb-1", isRTL && "flex-row-reverse")}>
                      <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      <span className="text-xs font-bold uppercase tracking-wider">{t('customs')} (СВХ)</span>
                    </div>
                    <p className={cn("text-sm font-bold text-slate-900", isRTL && "text-right")}>
                      {format(parseISO(shipment.customs_date), 'yyyy-MM-dd')}
                    </p>
                  </div>
                )}
                {shipment.actual_arrival_date && (
                  <div className="p-3 sm:p-4 bg-emerald-50/50 rounded-xl border border-emerald-100">
                    <div className={cn("flex items-center gap-2 text-emerald-600 mb-1", isRTL && "flex-row-reverse")}>
                      <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      <span className="text-xs font-bold uppercase tracking-wider">{t('delivered')} (Алматы)</span>
                    </div>
                    <p className={cn("text-sm font-bold text-slate-900", isRTL && "text-right")}>
                      {format(parseISO(shipment.actual_arrival_date), 'yyyy-MM-dd')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {shipment.status_message && (
              <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 mb-6">
                <div className={cn("flex items-center gap-2 text-blue-700 mb-2", isRTL && "flex-row-reverse")}>
                  <AlertCircle className="w-5 h-5" />
                  <h4 className="font-bold">{t('currentStatusMessage')}</h4>
                </div>
                <p className={cn("text-sm text-blue-800 leading-relaxed font-medium", isRTL && "text-right")}>
                  {shipment.status_message}
                </p>
              </div>
            )}

            {shipment.items && shipment.items.length > 0 && (
              <div className="mt-6 pt-6 border-t border-slate-100">
                <div className={cn("flex items-center gap-2 text-slate-500 mb-4", isRTL && "flex-row-reverse")}>
                  <Package className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">{t('items')}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {shipment.items.map((item, idx) => (
                    <span 
                      key={idx}
                      className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg border border-blue-100"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className={cn("flex items-center justify-between mb-6", isRTL && "flex-row-reverse")}>
              <h3 className="text-lg font-bold text-slate-900">{t('files')}</h3>
              {isLogistics && (
                <div className="flex flex-col items-end gap-2">
                  <label className="cursor-pointer px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    {uploading ? `${Math.round(uploadProgress)}%` : t('uploadFile')}
                    <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                  </label>
                  {uploading && (
                    <div className="w-32 h-1 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-600 transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {shipment.documents_url?.map((url, idx) => (
                <div key={idx} className="relative group/file">
                  <a 
                    href={url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className={cn(
                      "p-3 bg-slate-50 border border-slate-100 rounded-xl hover:border-blue-200 hover:bg-blue-50 transition-all flex items-center gap-3 group",
                      isRTL && "flex-row-reverse"
                    )}
                  >
                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm group-hover:text-blue-600">
                      <FileText className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-medium text-slate-600 truncate">Doc {idx + 1}</span>
                  </a>
                  {isLogistics && (
                    <button
                      onClick={() => setFileToDelete(url)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-100 text-red-600 rounded-full flex items-center justify-center opacity-0 group-hover/file:opacity-100 transition-opacity shadow-sm hover:bg-red-200"
                      title={t('deleteFile')}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {(!shipment.documents_url || shipment.documents_url.length === 0) && (
                <p className="col-span-full text-center py-4 text-sm text-slate-400 italic">{t('noFiles')}</p>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h3 className={cn("text-lg font-bold text-slate-900 mb-6", isRTL && "text-right")}>{t('journeyLogs')}</h3>
            <div className={cn(
              "space-y-8 relative before:absolute before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-100",
              isRTL ? "before:right-4 pr-10" : "before:left-4 pl-10"
            )}>
              {logs.map((log) => (
                <div key={log.id} className="relative">
                  <div className={cn(
                    "absolute top-1.5 w-3 h-3 rounded-full bg-blue-600 border-4 border-white shadow-sm",
                    isRTL ? "-right-7.5" : "-left-7.5"
                  )} />
                  <div className={cn("flex items-center justify-between mb-1", isRTL && "flex-row-reverse")}>
                    <p className="text-sm font-bold text-slate-900">{log.location}</p>
                    <span className="text-[10px] font-medium text-slate-400">
                      {format(parseISO(log.timestamp), 'MMM d, HH:mm')}
                    </span>
                  </div>
                  <p className={cn("text-sm text-slate-600 mb-1", isRTL && "text-right")}>{log.message}</p>
                  <p className={cn("text-[10px] text-slate-400", isRTL && "text-right")}>Updated by {log.updatedBy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {isLogistics && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <h3 className={cn("text-lg font-bold text-slate-900 mb-4", isRTL && "text-right")}>{t('updateStatus')}</h3>
              <div className="space-y-4">
                <div>
                  <label className={cn("block text-xs font-bold text-slate-500 uppercase mb-1.5", isRTL && "text-right")}>{t('status')}</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as ShipmentStatus)}
                    className={cn("w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm", isRTL && "text-right")}
                  >
                    <option value="In Transit">{t('In Transit')}</option>
                    <option value="Customs">{t('Customs')}</option>
                    <option value="Delivered">{t('Delivered')}</option>
                    <option value="Delay">
                      {t('Delay')}
                    </option>
                  </select>
                </div>
                <div>
                   <label className={cn("block text-xs font-bold text-slate-500 uppercase mb-1.5", isRTL && "text-right")}>{t('statusMessage')}</label>
                   <textarea
                     value={statusMessage}
                     onChange={(e) => setStatusMessage(e.target.value)}
                     placeholder="..."
                     className={cn("w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm h-24 resize-none mb-4", isRTL && "text-right")}
                   />
                 </div>
                 <div>
                  <label className={cn("block text-xs font-bold text-slate-500 uppercase mb-1.5", isRTL && "text-right")}>{t('journeyLog')}</label>
                  <textarea
                    value={newLog}
                    onChange={(e) => setNewLog(e.target.value)}
                    placeholder="..."
                    className={cn("w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm h-24 resize-none", isRTL && "text-right")}
                  />
                </div>
                <button
                  onClick={handleUpdate}
                  className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-900/10"
                >
                  {t('postUpdate')}
                </button>
              </div>
            </div>
          )}

          <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100">
            <div className={cn("flex items-center gap-2 text-amber-700 mb-2", isRTL && "flex-row-reverse")}>
              <AlertCircle className="w-5 h-5" />
              <h4 className="font-bold">{t('shipmentNotes')}</h4>
            </div>
            <p className={cn("text-sm text-amber-800 leading-relaxed", isRTL && "text-right")}>
              {t('noNotes')}
            </p>
          </div>
        </div>
      </div>

      {/* File Delete Confirmation Modal */}
      <AnimatePresence>
        {fileToDelete && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6"
            >
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mb-4 mx-auto">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center mb-2">{t('deleteFile')}</h3>
              <p className="text-slate-500 text-center text-sm mb-6">{t('confirmDeleteFile')}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setFileToDelete(null)}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleFileDelete}
                  className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors"
                >
                  {t('delete')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6"
            >
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mb-4 mx-auto">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center mb-2">{t('delete')}</h3>
              <p className="text-slate-500 text-center text-sm mb-6">{t('confirmDelete')}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors"
                >
                  {t('delete')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
