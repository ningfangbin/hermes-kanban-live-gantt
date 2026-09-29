export const useState = initial => [typeof initial === "function" ? initial() : initial, () => {}]
export const useEffect = () => {}
export const useMemo = fn => (typeof fn === "function" ? fn() : fn)
export const useRef = initial => ({ current: initial })
export const createElement = (type, props, ...children) => ({ type, props, children })
export default { useState, useEffect, useMemo, useRef }
