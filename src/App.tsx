import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { BottomNav } from '@/components/BottomNav';
import Home from '@/pages/Home';
import Import from '@/pages/Import';
import ImportUbereats from '@/pages/ImportUbereats';
import ImportPayment from '@/pages/ImportPayment';
import ImportText from '@/pages/ImportText';
import ImportUberEatsText from '@/pages/ImportUberEatsText';
import ImportGroupOrder from '@/pages/ImportGroupOrder';
import NewOrder from '@/pages/NewOrder';
import EditOrder from '@/pages/EditOrder';
import OrderDetail from '@/pages/OrderDetail';
import OrderNotify from '@/pages/OrderNotify';
import People from '@/pages/People';
import PersonDetail from '@/pages/PersonDetail';
import History from '@/pages/History';
import Reconcile from '@/pages/Reconcile';
import Payments from '@/pages/Payments';
import Settings from '@/pages/Settings';
import ShortcutGuide from '@/pages/ShortcutGuide';

// Fires ONLY on visibilitychange (app comes to foreground) — not on every click/navigation
function ClipboardRedirect() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      if (window.location.pathname === '/import/group-order') return;
      try {
        const text = await navigator.clipboard.readText();
        if (
          text &&
          text.includes('group-order') &&
          (text.includes('ubereats.com') || text.includes('eats.uber.com'))
        ) {
          navigateRef.current('/import/group-order');
        }
      } catch { /* permission denied */ }
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []); // empty deps — listener registered once, never torn down on route change

  return null;
}

export default function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto w-full max-w-screen-sm flex-1 safe-bottom">
        <ClipboardRedirect />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/import" element={<Import />} />
          <Route path="/import/ubereats" element={<ImportUbereats />} />
          <Route path="/import/payment" element={<ImportPayment />} />
          <Route path="/import/text" element={<ImportText />} />
          <Route path="/import/ubereats-text" element={<ImportUberEatsText />} />
          <Route path="/import/group-order" element={<ImportGroupOrder />} />
          <Route path="/orders/new" element={<NewOrder />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/orders/:id/edit" element={<EditOrder />} />
          <Route path="/orders/:id/notify" element={<OrderNotify />} />
          <Route path="/people" element={<People />} />
          <Route path="/people/:id" element={<PersonDetail />} />
          <Route path="/history" element={<History />} />
          <Route path="/reconcile" element={<Reconcile />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/shortcut" element={<ShortcutGuide />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
