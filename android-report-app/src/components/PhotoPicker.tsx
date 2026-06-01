import React from 'react';
import {
  View, Text, TouchableOpacity, Image,
  StyleSheet, FlatList, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { theme } from '../constants/theme';

const MAX_PHOTOS = 6;

interface Props {
  uris:     string[];
  onChange: (uris: string[]) => void;
}

export default function PhotoPicker({ uris, onChange }: Props) {
  const addPhoto = () => {
    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Camera',  onPress: () => pick('camera') },
      { text: 'Gallery', onPress: () => pick('gallery') },
      { text: 'Cancel',  style: 'cancel' },
    ]);
  };

  const pick = async (source: 'camera' | 'gallery') => {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!perm.granted) {
      Alert.alert('Permission required', 'Enable access in device settings.');
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - uris.length });

    if (result.canceled) return;
    const newUris = result.assets.map(a => a.uri);
    onChange([...uris, ...newUris].slice(0, MAX_PHOTOS));
  };

  const remove = (uri: string) => {
    onChange(uris.filter(u => u !== uri));
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Photos (Optional)</Text>
      <View style={styles.grid}>
        {uris.map(uri => (
          <View key={uri} style={styles.thumb}>
            <Image source={{ uri }} style={styles.thumbImg} />
            <TouchableOpacity style={styles.removeBtn} onPress={() => remove(uri)}>
              <Text style={styles.removeText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        {uris.length < MAX_PHOTOS && (
          <TouchableOpacity style={styles.addBtn} onPress={addPhoto}>
            <Text style={styles.addIcon}>+</Text>
            <Text style={styles.addLabel}>Add</Text>
          </TouchableOpacity>
        )}
      </View>
      {uris.length > 0 && (
        <Text style={styles.hint}>
          {uris.length} photo{uris.length !== 1 ? 's' : ''} — will be noted in the report.
          Attach directly in Slack for full upload.
        </Text>
      )}
    </View>
  );
}

const THUMB = 80;

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.md,
  },
  label: {
    color:         theme.subtext,
    fontSize:      theme.font.sm,
    marginBottom:  theme.spacing.sm,
    fontWeight:    '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  grid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           theme.spacing.sm,
  },
  thumb: {
    width:        THUMB,
    height:       THUMB,
    borderRadius: theme.radius.sm,
    overflow:     'hidden',
  },
  thumbImg: {
    width:  '100%',
    height: '100%',
  },
  removeBtn: {
    position:        'absolute',
    top:             2,
    right:           2,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius:    10,
    width:           20,
    height:          20,
    alignItems:      'center',
    justifyContent:  'center',
  },
  removeText: {
    color:    theme.white,
    fontSize: 10,
    fontWeight: '700',
  },
  addBtn: {
    width:           THUMB,
    height:          THUMB,
    borderRadius:    theme.radius.sm,
    borderWidth:     2,
    borderColor:     theme.border,
    borderStyle:     'dashed',
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: theme.bg3,
  },
  addIcon: {
    color:    theme.subtext,
    fontSize: 24,
    lineHeight: 28,
  },
  addLabel: {
    color:    theme.placeholder,
    fontSize: theme.font.sm - 1,
  },
  hint: {
    color:     theme.placeholder,
    fontSize:  theme.font.sm - 1,
    marginTop: theme.spacing.xs,
    fontStyle: 'italic',
  },
});
