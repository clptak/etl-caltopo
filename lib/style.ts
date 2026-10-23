/**
 * TAK → CalTopo marker symbols, ported from the Node-RED sync's "Globalize Icon Translation"
 * and "Normalize CoT" nodes and driven by the same icon-configs mappings (lib/icons.ts)
 */
export type IconMapping = {
    /** CalTopo marker-symbol, ie: point, cp or a team's custom icon-XXXX label */
    iconLabel: string;
    cotType?: string | null;
    /** TAK iconset icon file, ie: Helibase.png - empty for a CoT type only mapping */
    iconName?: string | null;
    iconsetUid?: string | null;
    iconsetFolder?: string | null;
    takIconUrl?: string | null;
};

export class IconIndex {
    /** Lowercase iconset paths (<uid>/<folder>/<name>) and CoT types to CalTopo symbols */
    takToCalTopo = new Map<string, string>();

    constructor(mappings: IconMapping[]) {
        for (const m of mappings) {
            if (m.iconsetUid && m.iconName) {
                const path = m.iconsetFolder
                    ? `${m.iconsetUid}/${m.iconsetFolder}/${m.iconName}`
                    : `${m.iconsetUid}/${m.iconName}`;
                this.takToCalTopo.set(path.toLowerCase(), m.iconLabel);
            }
        }

        // A mapping without an iconset is a direct CoT type → symbol mapping and always wins
        // (the last one for a type); iconset mappings only fill CoT types left without one
        const direct = new Map<string, string>();
        const fallback = new Map<string, string>();
        for (const m of mappings) {
            if (!m.cotType) continue;
            if (!m.iconsetUid) {
                direct.set(m.cotType, m.iconLabel);
            } else if (!fallback.has(m.cotType)) {
                fallback.set(m.cotType, m.iconLabel);
            }
        }

        for (const [type, label] of [...fallback, ...direct]) this.takToCalTopo.set(type, label);
    }

    /**
     * The CalTopo symbol for a TAK marker - its iconset icon when mapped, else its CoT type,
     * else undefined so CalTopo uses its default
     *
     * TAK sends iconset icons as <uid>:<folder>/<name> or <uid>/<folder>/<name>
     */
    symbol(icon: unknown, type: unknown): string | undefined {
        if (typeof icon === 'string' && icon && (icon.includes(':') || (icon.includes('/') && !/^[a-z]-/.test(icon)))) {
            const path = icon.replace(':', '/').toLowerCase();
            const label = this.takToCalTopo.get(path) ?? this.takToCalTopo.get(`${path}.png`);
            if (label) return label;
        }

        if (typeof type === 'string' && type) return this.takToCalTopo.get(type);

        return undefined;
    }
}
