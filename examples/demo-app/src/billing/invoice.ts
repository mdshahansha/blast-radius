// Unrelated code that uses a field called `name`. It should not be flagged.
export function invoiceLine(product: { name: string; price: number }) {
  return `${product.name}: ${product.price}`;
}
