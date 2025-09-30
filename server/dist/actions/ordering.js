import { getActionPriorityDescriptor } from "./actionRequest.js";
function compareNumber(a, b) {
    if (a < b) {
        return -1;
    }
    if (a > b) {
        return 1;
    }
    return 0;
}
export function comparePriorityDescriptors(a, b) {
    const priorityComparison = compareNumber(a.priorityTier, b.priorityTier);
    if (priorityComparison !== 0) {
        return priorityComparison;
    }
    const categoryComparison = compareNumber(a.categoryRank, b.categoryRank);
    if (categoryComparison !== 0) {
        return categoryComparison;
    }
    const initiativeComparison = compareNumber(a.initiativeRank, b.initiativeRank);
    if (initiativeComparison !== 0) {
        return initiativeComparison;
    }
    const timestampComparison = compareNumber(a.timestamp, b.timestamp);
    if (timestampComparison !== 0) {
        return timestampComparison;
    }
    return 0;
}
export function compareActionRequests(a, b) {
    const descriptorComparison = comparePriorityDescriptors(getActionPriorityDescriptor(a), getActionPriorityDescriptor(b));
    if (descriptorComparison !== 0) {
        return descriptorComparison;
    }
    if (a.timestamp !== b.timestamp) {
        return compareNumber(a.timestamp, b.timestamp);
    }
    return a.id.localeCompare(b.id);
}
export function sortActionRequests(actions) {
    return [...actions].sort(compareActionRequests);
}
//# sourceMappingURL=ordering.js.map