import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+N → focus thought input on home page
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        navigate("/");
        // Small delay to ensure page renders, then focus
        setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>(
            'input[placeholder*="记下"]'
          );
          input?.focus();
        }, 50);
      }

      // Ctrl+K → go to search
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        navigate("/search");
        setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>(
            'input[placeholder*="Describe"]'
          );
          input?.focus();
        }, 50);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);
}
