import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AdminGate from './components/AdminGate.jsx';
import Home from './pages/Home.jsx';
import Editor from './pages/Editor.jsx';
import Presenter from './pages/Presenter.jsx';
import Screen from './pages/Screen.jsx';
import Audience from './pages/Audience.jsx';
import Report from './pages/Report.jsx';
import './styles.css';

const admin = (element) => <AdminGate>{element}</AdminGate>;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={admin(<Home />)} />
        <Route path="/p/:id" element={admin(<Editor />)} />
        <Route path="/present/:sessionId" element={admin(<Presenter />)} />
        <Route path="/screen/:sessionId" element={admin(<Screen />)} />
        <Route path="/sessions/:sessionId" element={admin(<Report />)} />
        <Route path="/join" element={<Audience />} />
        <Route path="/join/:code" element={<Audience />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
