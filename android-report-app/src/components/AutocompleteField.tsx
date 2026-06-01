import React, { useState, useRef, useCallback } from 'react';
import {
  View, TextInput, FlatList, TouchableOpacity,
  Text, StyleSheet, Keyboard,
} from 'react-native';
import { searchSuggestions, Suggestion } from '../db/clients';
import { theme } from '../constants/theme';

interface Props {
  label:       string;
  value:       string;
  onChange:    (val: string) => void;
  placeholder?: string;
}

export default function AutocompleteField({ label, value, onChange, placeholder }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen]               = useState(false);
  const debounce                      = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((text: string) => {
    onChange(text);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      if (text.trim().length >= 1) {
        const results = await searchSuggestions(text);
        setSuggestions(results);
        setOpen(results.length > 0);
      } else {
        setSuggestions([]);
        setOpen(false);
      }
    }, 250);
  }, [onChange]);

  const select = (s: Suggestion) => {
    onChange(s.name);
    setSuggestions([]);
    setOpen(false);
    Keyboard.dismiss();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={handleChange}
        placeholder={placeholder ?? `Search or type ${label.toLowerCase()}…`}
        placeholderTextColor={theme.placeholder}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <View style={styles.dropdown}>
          <FlatList
            data={suggestions}
            keyExtractor={item => `${item.kind}-${item.id}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.item} onPress={() => select(item)}>
                <Text style={styles.itemText}>{item.name}</Text>
                <Text style={styles.itemKind}>{item.kind}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.md,
    zIndex: 10,
  },
  label: {
    color:        theme.subtext,
    fontSize:     theme.font.sm,
    marginBottom: theme.spacing.xs,
    fontWeight:   '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: theme.bg3,
    borderWidth:     1,
    borderColor:     theme.border,
    borderRadius:    theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical:   theme.spacing.sm + 2,
    color:           theme.text,
    fontSize:        theme.font.md,
  },
  dropdown: {
    position:        'absolute',
    top:             72,
    left:            0,
    right:           0,
    backgroundColor: theme.bg2,
    borderWidth:     1,
    borderColor:     theme.border,
    borderRadius:    theme.radius.md,
    maxHeight:       220,
    zIndex:          99,
    elevation:       8,
    shadowColor:     '#000',
    shadowOpacity:   0.4,
    shadowRadius:    8,
    shadowOffset:    { width: 0, height: 4 },
  },
  item: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical:   theme.spacing.md - 2,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  itemText: {
    color:     theme.text,
    fontSize:  theme.font.md,
    flexShrink: 1,
  },
  itemKind: {
    color:     theme.placeholder,
    fontSize:  theme.font.sm - 1,
    marginLeft: theme.spacing.sm,
  },
});
