import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-container">
        <div className="header-content">
          <div className="header-left">
            <h1 className="header-title">NightVault</h1>
            <span className="header-tagline">Confidential yield for the fTEST community</span>
          </div>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
