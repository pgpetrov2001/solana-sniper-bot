export const parseGraphqlResponse = <TResult extends Record<string, any>, TItem extends Record<string, any>>(
    items: TItem[],
): [string, TResult][] => {
    return items.map((item: TItem) => {
        const result = Object.fromEntries(
            Object.entries(item)
                .filter(([key, _]) => !['pubkey'].includes(key))
                .map(([key, val]) => [
                    key,
                    val == null ? '' : Array.isArray(val) ? val.map((x) => x.toString()) : val.toString(),
                ]),
        ) as TResult;
        return [item.pubkey as string, result] as [string, TResult];
    });
};
