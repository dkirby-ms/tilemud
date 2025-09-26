import React from 'react';

interface LogoutButtonProps {
  className?: string;
}

export const LogoutButton: React.FC<LogoutButtonProps> = ({ className }) => {
  return (
    <button 
      className={className}
      onClick={() => {
        // TODO: Implement logout logic
      }}
    >
      Logout
    </button>
  );
};