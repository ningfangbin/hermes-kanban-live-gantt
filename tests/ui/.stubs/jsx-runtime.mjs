function invokeComponent(type, props) {
  if (typeof type === 'function') {
    try {
      return type(props || {})
    } catch (err) {
      return { type, props: props || {}, renderError: err }
    }
  }
  return { type, props: props || {}, $$jsx: true }
}
export const jsx = (type, props) => invokeComponent(type, props)
export const jsxs = (type, props) => invokeComponent(type, props)
export const Fragment = 'Fragment'
