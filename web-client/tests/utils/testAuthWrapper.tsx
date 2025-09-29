import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../../src/providers/AuthProvider';

export const TestAuthWrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>
    <AuthProvider>
      {children}
    </AuthProvider>
  </BrowserRouter>
);