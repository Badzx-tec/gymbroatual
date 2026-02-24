import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { applyBrandingToDocument, loadBranding } from './branding';

applyBrandingToDocument(loadBranding());

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
