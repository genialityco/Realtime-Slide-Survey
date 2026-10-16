import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AdminGate from './components/AdminGate.jsx';
import Audience from './pages/Audience.jsx';
import Presenter from './pages/Presenter.jsx';
import Screen from './pages/Screen.jsx';
import Report from './pages/Report.jsx';
import Editor from './pages/Editor.jsx';
import './styles.css';

const admin = (element) => <AdminGate>{element}</AdminGate>;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Audience />} />
        <Route path="/admin" element={admin(<Presenter />)} />
        <Route path="/admin/editor" element={admin(<Editor />)} />
        <Route path="/admin/sesiones/:sessionId" element={admin(<Report />)} />
        <Route path="/proyeccion" element={admin(<Screen />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
