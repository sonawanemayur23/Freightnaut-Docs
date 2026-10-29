import { createContext, useContext } from "react";
export type LeaveGuard = () => Promise<void>;
export const NavigationContext = createContext<
  (guard: LeaveGuard) => () => void
>(() => () => {});
export const useNavigationGuard = () => useContext(NavigationContext);
