import React from 'react';
import { motion } from 'motion/react';
import { Navigation, AlertCircle, CheckCircle2, Clock, MapPin, Truck as TruckIcon, ChevronRight, Package } from 'lucide-react';
import { differenceInDays, parseISO, format } from 'date-fns';
import { useLanguage } from '../../contexts/LanguageContext';
import { Shipment } from '../../types';
import { cn } from '../../lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { isShipmentDelayed } from '../../utils/shipmentUtils';

interface DashboardProps {
  shipments: Shipment[];
  onSelect: (s: Shipment) => void;
}

export const Dashboard = ({ shipments, onSelect }: DashboardProps) => {
  const { t, isRTL } = useLanguage();
  
  const stats = [
    { label: t('activeShipments'), value: shipments.filter(s => s.status === 'In Transit' || s.status === 'Customs').length, icon: Navigation, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: t('delayed'), value: shipments.filter(s => isShipmentDelayed(s)).length, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
    { label: t('delivered'), value: shipments.filter(s => s.status === 'Delivered').length, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: t('avgDelay'), value: 0, icon: Clock, color: 'text-slate-600', bg: 'bg-slate-50' },
    { label: t('averageCustomsDuration'), value: 0, icon: MapPin, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: t('itemsInTransit'), value: 0, icon: Package, color: 'text-amber-600', bg: 'bg-amber-50' },
  ];

  // Calculate Avg Delay
  const deliveredShipments = shipments.filter(s => s.status === 'Delivered' && s.actual_arrival_date);
  if (deliveredShipments.length > 0) {
    const totalDelay = deliveredShipments.reduce((acc, s) => {
      const delay = Math.max(0, differenceInDays(parseISO(s.actual_arrival_date!), parseISO(s.arrival_deadline)));
      return acc + delay;
    }, 0);
    stats[3].value = Math.round(totalDelay / deliveredShipments.length);
  }

  // Calculate Avg Customs Duration
  const clearedShipments = shipments.filter(s => s.customs_date && s.actual_arrival_date);
  if (clearedShipments.length > 0) {
    const totalCustoms = clearedShipments.reduce((acc, s) => {
      const duration = Math.max(0, differenceInDays(parseISO(s.actual_arrival_date!), parseISO(s.customs_date!)));
      return acc + duration;
    }, 0);
    stats[4].value = Math.round(totalCustoms / clearedShipments.length);
  }

  // Calculate total unique items in transit
  const transitShipments = shipments.filter(s => s.status !== 'Delivered');
  const itemsMap = new Map<string, number>();
  transitShipments.forEach(s => {
    s.items?.forEach(item => {
      const normalizedItem = item.trim();
      if (normalizedItem) {
        itemsMap.set(normalizedItem, (itemsMap.get(normalizedItem) || 0) + 1);
      }
    });
  });
  const sortedItems = Array.from(itemsMap.entries()).sort((a, b) => b[1] - a[1]);
  stats[5].value = sortedItems.length;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 sm:gap-6">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-100"
          >
            <div className={cn("w-10 h-10 sm:w-12 h-12 rounded-xl flex items-center justify-center mb-3 sm:mb-4", stat.bg)}>
              <stat.icon className={cn("w-5 h-5 sm:w-6 h-6", stat.color)} />
            </div>
            <p className={cn("text-slate-500 text-[10px] sm:text-sm font-medium uppercase tracking-wider sm:normal-case sm:tracking-normal", isRTL && "text-right")}>{stat.label}</p>
            <p className={cn("text-xl sm:text-2xl font-bold text-slate-900 mt-1", isRTL && "text-right")}>{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className={cn("text-lg font-bold text-slate-900 mb-6", isRTL && "text-right")}>{t('recentActivity')}</h3>
          <div className="space-y-4">
            {shipments.slice(0, 5).map((s) => {
              const isDelayed = isShipmentDelayed(s);
              return (
                <div 
                  key={s.id} 
                  onClick={() => onSelect(s)}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl hover:bg-slate-50 transition-all cursor-pointer border border-transparent hover:border-slate-100",
                    isRTL && "flex-row-reverse"
                  )}
                >
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                    s.status === 'Delivered' ? 'bg-emerald-50 text-emerald-600' : 
                    isDelayed ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                  )}>
                    <TruckIcon className="w-5 h-5" />
                  </div>
                  <div className={cn("flex-1 min-w-0", isRTL ? "text-right" : "text-left")}>
                    <p className="text-sm font-bold text-slate-900 truncate">{s.invoice_id}</p>
                    <p className="text-xs text-slate-500 truncate">{s.route}</p>
                  </div>
                      <div className={isRTL ? "text-left" : "text-right"}>
                        <p className={cn(
                          "text-[10px] font-bold uppercase tracking-widest",
                          s.status === 'Delivered' ? 'text-emerald-600' : 
                          isDelayed ? 'text-red-600' : 'text-blue-600'
                        )}>
                          {t(s.status as any)}
                          {isDelayed && s.status !== 'Delivered' && (
                            <span className="ml-1 text-[8px] opacity-75">({t('delayed')})</span>
                          )}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{format(parseISO(s.last_updated), 'MMM d, HH:mm')}</p>
                      </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className={cn("text-lg font-bold text-slate-900 mb-6", isRTL && "text-right")}>{t('routePerformance')}</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[
                { name: 'W1', Almaty: 12, Tehran: 14 },
                { name: 'W2', Almaty: 13, Tehran: 12 },
                { name: 'W3', Almaty: 11, Tehran: 15 },
                { name: 'W4', Almaty: 14, Tehran: 13 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Line type="monotone" dataKey="Almaty" stroke="#2563eb" strokeWidth={3} dot={{ r: 4, fill: '#2563eb' }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="Tehran" stroke="#94a3b8" strokeWidth={3} dot={{ r: 4, fill: '#94a3b8' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <h3 className={cn("text-lg font-bold text-slate-900 mb-6", isRTL && "text-right")}>{t('totalGoodsInTransit')}</h3>
        {sortedItems.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {sortedItems.map(([item, count]) => (
              <div key={item} className={cn("bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col", isRTL && "text-right")}>
                <p className="text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">{t('items')}</p>
                <div className={cn("flex items-center justify-between gap-2", isRTL && "flex-row-reverse")}>
                  <span className="text-sm font-bold text-slate-700 truncate">{item}</span>
                  <span className="px-2 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">x{count}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500 font-medium text-sm">{t('noGoodsInTransit')}</p>
          </div>
        )}
      </div>
    </div>
  );
};
