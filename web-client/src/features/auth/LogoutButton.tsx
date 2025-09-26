import React from 'react';
import { useLogout } from './useLogout';

interface LogoutButtonProps {
  className?: string;
}

export const LogoutButton: React.FC<LogoutButtonProps> = ({ className }) => {
  const { logout, isLoggingOut, showSpinner } = useLogout();

  const handleClick = async () => {
    await logout();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  };

  return (
    <button 
      className={className}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={isLoggingOut}
      aria-label="Logout"
      type="button"
    >
      {showSpinner ? (
        <>
          <span aria-hidden="true">⏳</span> Logging out...
        </>
      ) : (
        'Logout'
      )}
    </button>
  );
};