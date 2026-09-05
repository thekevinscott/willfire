/** Shared by the step walk and by the pre-scan that picks the tree provider. */
export const isCheckout = (uses: string): boolean => /^actions\/checkout@/.test(uses);
